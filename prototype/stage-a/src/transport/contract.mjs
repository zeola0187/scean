// Transport contract used by the prototype UI.
//
// Every UI read/write goes through `transport.call(action, payload)`, the same
// shape as the real `scean/request {action, ...payload}` RPC. P1 replaces the
// mock with HTTP (isolated server) or Typert (native) adapters; the UI must not
// import the mock directly.
//
// status: 'existing'  = action exists in plugin/host.mjs at rc3 (payload simplified)
//         'proposed'  = contract proposal from the phase-1 report, NOT in Host yet
export const ACTIONS = Object.freeze({
  scriptList:       {status: 'existing', note: 'Saved scripts (作品・版本).'},
  scriptGet:        {status: 'existing'},
  list:             {status: 'existing', note: 'Runs. Real Host lacks last line / clock label → proposed homeSummary.'},
  homeSummary:      {status: 'proposed', note: 'Mock serves list() enriched rows under this name.'},
  openingStart:     {status: 'existing'},
  runView:          {status: 'existing', note: 'Includes requestReceipt when requestId is passed.'},
  historyPage:      {status: 'existing', note: 'Per-turn public `changes` are a proposal (report §7-2); mock computes them.'},
  turn:             {status: 'existing'},
  progress:         {status: 'existing', note: 'Polled, as in the real client.'},
  cancel:           {status: 'existing'},
  settlementBody:   {status: 'existing', note: 'Saved-not-committed body for a failed settlement.'},
  settlementResume: {status: 'existing', note: 'Real Host: resumeSettlement via job submit.'},
  rollback:         {status: 'existing'},
  regenerate:       {status: 'existing'},
  worldRoutineRead: {status: 'existing', note: 'kind: calendar | forum.'},
  playerWorldbook:  {status: 'existing', note: 'FULL worldbook incl. spoilers. Never labelled as player knowledge.'},
  revealedLore:     {status: 'proposed', note: 'Not implemented → mock throws NOT_IMPLEMENTED.'},
  playerIdeas:      {status: 'existing'},
  playerRecap:      {status: 'existing'},
});

export class TransportError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}
