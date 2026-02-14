import type { Pod, Container, PodCondition } from "../builtin/core@v1/structs.ts";

/**
 * Extra utility to assist with representing Pod health e.g. to a user.
 * @module
 */

/** A judgement of a Pod's latest health. */
export type PodHealth = {
	/** A string representation of ready vs. total containers e.g. "1/1", "0/2" (kubectl READY column) */
	readyCount: string;
	/** A flexible string summarizing pod status e.g. "Running", "CrashLoopBackOff" (kubectl STATUS column) */
	reason: string;
	/** Number of observed container restarts (main part of kubectl RESTARTS column) */
	restarts: number;
	/** Date of latest container restart, if any (added on to kubectl RESTARTS column) */
	lastRestartDate: Date | undefined;
};

/**
 * Determines the overall health of a given Pod.
 * This function evaluates health using the same logic as `kubectl get pods`.
 * @param pod A Pod object retrieved from Kubernetes API.
 * @returns Values for kubectl's READY, STATUS, and RESTARTS columns.
 */
export function calculatePodHealth(pod: Pod): PodHealth {

	// Grabs a particular condition off the pod status
	function getCondition(conditionType: string): PodCondition | undefined {
		return pod.status?.conditions?.find(
			condition => condition.type == conditionType);
	}

	// Following function body is generally a port of:
	// https://github.com/kubernetes/kubernetes/blob/v1.35.1/pkg/printers/internalversion/printers.go#L899

	let restarts = 0;
	let restartableInitContainerRestarts = 0;
	let totalContainers = pod.spec?.containers.length ?? 0;
	let readyContainers = 0;
	let lastRestartDate = new Date(0);
	let lastRestartableInitContainerRestartDate = new Date(0);

	const podPhase = pod.status?.phase;
	let reason = pod.status?.reason || podPhase || 'Unknown';

	// If the Pod carries {type:PodScheduled, reason:SchedulingGated}, set reason to 'SchedulingGated'.
	if (getCondition('PodScheduled')?.reason == 'SchedulingGated') {
		reason = 'SchedulingGated';
	}

	const initContainers = new Map<string,Container>()
  for (const container of pod.spec?.initContainers ?? []) {
		initContainers.set(container.name, container);
		if (container.restartPolicy == 'Always') {
			totalContainers++;
		}
	}

	let initializing = false;
  const statuses = pod.status?.initContainerStatuses ?? [];
  initContainerLoop: for (const [i, container] of statuses.entries()) {
		restarts += container.restartCount ?? 0;
		if (container.lastState?.terminated) {
			const terminatedDate = container.lastState.terminated.finishedAt;
			if (terminatedDate && lastRestartDate < terminatedDate) {
				lastRestartDate = terminatedDate;
			}
		}
		if (initContainers.get(container.name)?.restartPolicy == 'Always') {
			restartableInitContainerRestarts += container.restartCount
			if (container.lastState?.terminated) {
				const terminatedDate = container.lastState.terminated.finishedAt;
				if (terminatedDate && lastRestartableInitContainerRestartDate < terminatedDate) {
					lastRestartableInitContainerRestartDate = terminatedDate;
				}
			}
		}
		switch (true) {
		case container.state?.terminated?.exitCode == 0:
			continue initContainerLoop;
		case initContainers.get(container.name)?.restartPolicy == 'Always' && container.started:
			if (container.ready) {
				readyContainers++;
			}
			continue initContainerLoop;
		case container.state?.terminated != null:
			// initialization is failed
			if (!container.state?.terminated.reason) {
				if (container.state?.terminated.signal != 0) {
					reason = `Init:Signal:${container.state?.terminated.signal}`;
				} else {
					reason = `Init:ExitCode:${container.state?.terminated.exitCode}`;
				}
			} else {
				reason = `Init:${container.state?.terminated.reason}`;
			}
			initializing = true;
      break;
		case container.state?.waiting?.reason && container.state.waiting.reason != "PodInitializing":
			reason = `Init:${container.state.waiting.reason}`;
			initializing = true;
      break;
		default:
			reason = `Init:${i}/${pod.spec?.initContainers?.length}`;
			initializing = true;
		}
		break;
	}

	if (!initializing || getCondition('Initialized')?.status == 'True') {
		restarts = restartableInitContainerRestarts;
		lastRestartDate = lastRestartableInitContainerRestartDate;
		let hasRunning = false;
		let errorReason = "";
		for (const container of pod.status?.containerStatuses?.toReversed() ?? []) {
			restarts += container.restartCount;
			if (container.lastState?.terminated != null) {
				const terminatedDate = container.lastState?.terminated.finishedAt;
				if (terminatedDate && lastRestartDate < terminatedDate) {
					lastRestartDate = terminatedDate;
				}
			}
			if (container.state?.waiting?.reason) {
				reason = container.state.waiting.reason;
      } else if (container.state?.terminated) {
				if (container.state.terminated.reason) {
					reason = container.state.terminated.reason;
				} else if (container.state.terminated.signal != 0) {
					reason = `Signal:${container.state.terminated.signal}`;
				} else {
					reason = `ExitCode:${container.state.terminated.exitCode}`;
				}
				if (container.state.terminated.exitCode != 0) {
					errorReason = reason;
				}
      } else if (container.ready && container.state?.running) {
				hasRunning = true;
				readyContainers++;
			}
		}

		// change pod status back to "Running" if there is at least one container still reporting as "Running" status
		if (reason == "Completed") {
			if (hasRunning && getCondition('Ready')?.status == 'True') {
				reason = "Running";
			} else if (errorReason) {
				reason = errorReason;
			} else if (hasRunning) {
				reason = "NotReady";
			}
		}
	}

	if (pod.metadata?.deletionTimestamp) {
    if (pod.status?.reason == 'NodeLost') {
      reason = "Unknown";
    } else if (!(podPhase == 'Failed' || podPhase == 'Succeeded')) {
      reason = "Terminating";
    }
  }

  return {
    readyCount: `${readyContainers}/${totalContainers}`,
    reason,
    restarts,
    lastRestartDate: lastRestartDate.valueOf() ? lastRestartDate : void 0,
  };
}
