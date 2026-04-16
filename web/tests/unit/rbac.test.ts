import { describe, it, expect } from 'vitest';
import { canPerform } from '@/lib/rbac';

describe('canPerform', () => {
  it('allows admin to upload batch', () => {
    expect(canPerform('admin', 'batch.upload')).toBe(true);
  });
  it('denies annotator to upload batch', () => {
    expect(canPerform('annotator', 'batch.upload')).toBe(false);
  });
  it('allows annotator to submit own image', () => {
    expect(canPerform('annotator', 'image.submit')).toBe(true);
  });
  it('allows final_reviewer to approve', () => {
    expect(canPerform('final_reviewer', 'image.approve')).toBe(true);
  });
  it('denies annotator to approve', () => {
    expect(canPerform('annotator', 'image.approve')).toBe(false);
  });
  it('denies final_reviewer to assign', () => {
    expect(canPerform('final_reviewer', 'batch.assign')).toBe(false);
  });
});
