// @selfos/core/conversations — transcripts, the system-prompt builder, and the chat-turn orchestrator
// (host/main-only).
export * from './conversationService';
export * from './rewindService';
export * from './promptBuilder';
export * from './chatService';
export * from './wrapUp';
export * from './sessionAnalysisService';
export * from './guidedCatalog';
export * from './guidedSteps';
export * from './agreementMarker';
export * from './privateMarker';
export * from './guidedSessionService';
export * from './guidanceService';
export * from './topicClassifier';
export * from './challengeCoach';
export * from './challengeSession';
// The continuation contract (66 §5.1) — exported so the fake client keys off the SAME instruction the
// real path sends, instead of re-encoding the request shape and drifting from it.
export * from './streamWithContinuation';
