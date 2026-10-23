import { describe, expect, it } from 'vitest';

describe('test environment', () => {
  it('provides a DOM', () => {
    document.body.innerHTML = '<p>Hello</p>';
    expect(document.querySelector('p')?.textContent).toBe('Hello');
  });
});
