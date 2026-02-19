import { calculatePodHealth } from "@cloudydeno/kubernetes-apis/core/v1/pod-health";
import { assertObjectMatch } from "@std/assert/object-match";

// Some contrived tests of the pod health routine to make sure it generally functions

Deno.test('pod health helper', () => {
  const oneContainerSpec = {
    containers: [{
      name: 'app',
    }],
  };
  const emptyStatusFields = {
    name: 'app',
    image: '',
    imageID: '',
    ready: false,
    restartCount: 0,
  };

  // Null pod
  assertObjectMatch(calculatePodHealth({}), {
    reason: 'Unknown',
    readyCount: '0/0',
    restarts: 0,
    lastRestartDate: undefined,
  });

  // Containers not started yet
  assertObjectMatch(calculatePodHealth({
    spec: oneContainerSpec,
    status: {
      phase: 'Running',
      containerStatuses: [{
        ...emptyStatusFields,
        state: {
          waiting: {
            reason: 'Initializing',
          },
        },
      }],
    },
  }), {
    reason: 'Initializing',
    readyCount: '0/1',
    restarts: 0,
    lastRestartDate: undefined,
  });

  // Container running, not ready
  assertObjectMatch(calculatePodHealth({
    spec: oneContainerSpec,
    status: {
      phase: 'Running',
      containerStatuses: [{
        ...emptyStatusFields,
        state: {
          running: {
            startedAt: new Date,
          },
        },
      }],
    },
  }), {
    reason: 'Running',
    readyCount: '0/1',
    restarts: 0,
    lastRestartDate: undefined,
  });

  // Container passing readiness checks
  assertObjectMatch(calculatePodHealth({
    spec: oneContainerSpec,
    status: {
      phase: 'Running',
      containerStatuses: [{
        ...emptyStatusFields,
        ready: true,
        state: {
          running: {
            startedAt: new Date,
          },
        },
      }],
    },
  }), {
    reason: 'Running',
    readyCount: '1/1',
    restarts: 0,
    lastRestartDate: undefined,
  });

  // Container with liveness issues
  assertObjectMatch(calculatePodHealth({
    spec: oneContainerSpec,
    status: {
      phase: 'Running',
      containerStatuses: [{
        ...emptyStatusFields,
        ready: true,
        restartCount: 5,
        lastState: {
          terminated: {
            exitCode: 5,
            finishedAt: new Date(5),
          },
        },
        state: {
          waiting: {
            reason: 'CrashLoopBackOff',
          },
        },
      }],
    },
  }), {
    reason: 'CrashLoopBackOff',
    readyCount: '0/1',
    restarts: 5,
    lastRestartDate: new Date(5),
  });

  // Pod pending deletion
  assertObjectMatch(calculatePodHealth({
    metadata: {
      deletionTimestamp: new Date,
    },
  }), {
    reason: 'Terminating',
  });

});
