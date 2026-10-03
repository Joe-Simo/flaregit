import { expect, test } from 'bun:test';
import { changeCreationFollowup, type ChangeCreationResponse } from '../src/web/change-creation-followup';
const saved: ChangeCreationResponse = { commands:['git clone scoped-remote'], replayed:true, terminal:false, status:'working', agentRunId:null };
test('replayed accepted or cancelled changes never start agents or expose instructions', () => {
  for (const status of ['accepted','cancelled'] as const) expect(changeCreationFollowup({...saved,status,terminal:true},true)).toBe('terminal');
});
test('known agent run is preserved for both agent and Git preferences', () => {
  for (const preference of [true,false]) expect(changeCreationFollowup({...saved,agentRunId:'saved-run'},preference)).toBe('existing-agent');
});
test('only eligible unassigned work can start an agent', () => {
  expect(changeCreationFollowup(saved,true)).toBe('start-agent');
  expect(changeCreationFollowup(saved,false)).toBe('git');
  for (const status of ['ready','integrating','verifying'] as const) expect(changeCreationFollowup({...saved,status},true)).toBe('git');
});
test('inconsistent terminal state fails closed before followup', () => {
  expect(() => changeCreationFollowup({...saved,terminal:true},true)).toThrow();
  expect(() => changeCreationFollowup({...saved,status:'accepted'},true)).toThrow();
});
