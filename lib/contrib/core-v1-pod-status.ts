import type { Pod, Container, PodStatus } from "../builtin/core@v1/structs.ts";

// https://github.com/kubernetes/kubernetes/blob/23ea1ec286387f45f52e1189089bacc0702a00aa/pkg/api/v1/pod/util.go#L392
function isRestartableInitContainer(initContainer: Container | undefined): boolean {
	if (initContainer == null || initContainer.restartPolicy == null) {
		return false;
	}
	return initContainer.restartPolicy == 'Always';
}

// https://github.com/kubernetes/kubernetes/blob/8fea90b45245ef5c8ba54e7ae044d3e777c22500/pkg/printers/internalversion/printers.go
function isPodConditionTrue(conditionType: string, status: PodStatus | undefined | null): boolean {
	for (const condition of status?.conditions ?? []) {
		if (condition.type == conditionType) {
      return condition.status == 'True';
		}
	}
	return false;
}

// https://github.com/kubernetes/kubernetes/blob/8fea90b45245ef5c8ba54e7ae044d3e777c22500/pkg/printers/internalversion/printers.go#L899
function calculatePodHealth(pod: Pod) {
	let restarts = 0;
	let restartableInitContainerRestarts = 0;
	let totalContainers = pod.spec?.containers.length ?? 0;
	let readyContainers = 0;
	let lastRestartDate = new Date(0);
	let lastRestartableInitContainerRestartDate = new Date(0);

	const podPhase = pod.status?.phase;
	let reason = pod.status?.reason || podPhase || '';

	// If the Pod carries {type:PodScheduled, reason:SchedulingGated}, set reason to 'SchedulingGated'.
	for (const condition of pod.status?.conditions ?? []) {
		if (condition.type == 'PodScheduled' && condition.reason == 'SchedulingGated') {
			reason = 'SchedulingGated';
		}
	}

	const initContainers = new Map<string,Container>()
  for (const container of pod.spec?.initContainers ?? []) {
		initContainers.set(container.name, container);
		if (isRestartableInitContainer(container)) {
			totalContainers++;
		}
	}

	let initializing = false;
  const statuses = pod.status?.initContainerStatuses ?? [];
  containers: for (const [i, container] of statuses.entries()) {
		restarts += container.restartCount ?? 0;
		if (container.lastState?.terminated) {
			const terminatedDate = container.lastState.terminated.finishedAt;
			if (terminatedDate && lastRestartDate < terminatedDate) {
				lastRestartDate = terminatedDate;
			}
		}
		if (isRestartableInitContainer(initContainers.get(container.name))) {
			restartableInitContainerRestarts += container.restartCount
			if (container.lastState?.terminated) {
				const terminatedDate = container.lastState.terminated.finishedAt;
				if (terminatedDate && lastRestartableInitContainerRestartDate < terminatedDate) {
					lastRestartableInitContainerRestartDate = terminatedDate;
				}
			}
		}
		switch (true) {
		case container.state?.terminated != null && container.state?.terminated.exitCode == 0:
			continue containers;
		case isRestartableInitContainer(initContainers.get(container.name)) && container.started:
			if (container.ready) {
				readyContainers++;
			}
			continue containers;
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

	if (!initializing || isPodConditionTrue('Initialized', pod.status)) {
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
			if (hasRunning && isPodConditionTrue('Ready', pod.status)) {
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
