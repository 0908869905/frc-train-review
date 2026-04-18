export type ImageState =
  | 'unassigned'
  | 'assigned'
  | 'annotated'
  | 'under_review'
  | 'approved'
  | 'needs_rework';

export type Transition =
  | 'assign'
  | 'submit'
  | 'unsubmit'
  | 'enter_review'
  | 'promote'
  | 'approve'
  | 'reject'
  | 'resubmit';

const RULES: Record<Transition, { from: ImageState[]; to: ImageState }> = {
  assign: { from: ['unassigned'], to: 'assigned' },
  submit: { from: ['assigned'], to: 'annotated' },
  unsubmit: { from: ['annotated'], to: 'assigned' },
  enter_review: { from: ['annotated'], to: 'under_review' },
  promote: { from: ['annotated'], to: 'under_review' },
  approve: { from: ['under_review'], to: 'approved' },
  reject: { from: ['under_review'], to: 'needs_rework' },
  resubmit: { from: ['needs_rework'], to: 'under_review' },
};

export function canTransition(
  from: ImageState,
  action: Transition,
): boolean {
  return RULES[action].from.includes(from);
}

export function nextState(
  from: ImageState,
  action: Transition,
): ImageState {
  if (!canTransition(from, action)) {
    throw new Error(`Illegal transition ${from} --${action}-->`);
  }
  return RULES[action].to;
}
