
export const knownOptsForward = {
  GetListOpts: 'continue,fieldSelector,labelSelector,limit,resourceVersion,resourceVersionMatch,sendInitialEvents,timeoutSeconds',
  WatchListOpts: 'allowWatchBookmarks,fieldSelector,labelSelector,resourceVersion,resourceVersionMatch,sendInitialEvents,timeoutSeconds',
  PutOpts: 'dryRun,fieldManager,fieldValidation', // both CreateOpts and ReplaceOpts
  DeleteListOpts: 'continue,dryRun,fieldSelector,gracePeriodSeconds,ignoreStoreReadErrorWithClusterBreakingPotential,labelSelector,limit,orphanDependents,propagationPolicy,resourceVersion,resourceVersionMatch,sendInitialEvents,timeoutSeconds',
  PatchOpts: 'dryRun,fieldManager,fieldValidation,force',
  GetOpts: '',
  DeleteOpts: 'dryRun,gracePeriodSeconds,ignoreStoreReadErrorWithClusterBreakingPotential,orphanDependents,propagationPolicy',
};

export const knownOptsReverse: Record<string,string|undefined> = {
  '': 'NoOpts',
  [knownOptsForward.GetListOpts]: 'GetListOpts',
  [knownOptsForward.WatchListOpts]: 'WatchListOpts',
  [knownOptsForward.PutOpts]: 'PutOpts', // both CreateOpts and ReplaceOpts
  [knownOptsForward.DeleteListOpts]: 'DeleteListOpts',
  [knownOptsForward.PatchOpts]: 'PatchOpts',
  'exact,export': 'GetOpts',
  [knownOptsForward.DeleteOpts]: 'DeleteOpts',
};
