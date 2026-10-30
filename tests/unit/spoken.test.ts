import { describe, expect, it } from 'vitest';
import { spokenText } from '@/lib/tts/kokoro/spoken';

describe('spokenText', () => {
  it('reads a file path straight through, voicing its slashes and dot', () => {
    expect(spokenText('docs/agents/issue-tracker.md')).toBe('docs slash agents slash issue tracker dot md');
  });

  it('speaks a dot before a letter or digit, but not one that ends a sentence', () => {
    expect(spokenText('Open README.md first')).toBe('Open README dot md first');
    expect(spokenText('Node.js and example.com')).toBe('Node dot js and example dot com');
    expect(spokenText('See docs/x.md.')).toBe('See docs slash x dot md.');
    expect(spokenText('He said "stop." Then')).toBe('He said "stop." Then');
    expect(spokenText('Done. (See README.md.) Next')).toBe('Done. (See README dot md.) Next');
  });

  it('speaks leading dots', () => {
    expect(spokenText('.env')).toBe('dot env');
    expect(spokenText('./scripts')).toBe('dot slash scripts');
    expect(spokenText('../lib')).toBe('dot dot slash lib');
  });

  it('leaves dotted single-letter abbreviations and single-dot decimals unchanged', () => {
    expect(spokenText('Fruit, e.g. apples, i.e. food from the U.S.A. now')).toBe(
      'Fruit, e.g. apples, i.e. food from the U.S.A. now',
    );
    expect(spokenText('(i.e., this)')).toBe('(i.e., this)');
    expect(spokenText('Pi is 3.14 and costs $0.99.')).toBe('Pi is 3.14 and costs $0.99.');
  });

  it('speaks every dot when two or more separate digit groups', () => {
    expect(spokenText('Version 1.2.3 is out')).toBe('Version 1 dot 2 dot 3 is out');
    expect(spokenText('Ping 192.168.0.1.')).toBe('Ping 192 dot 168 dot 0 dot 1.');
  });

  it('never speaks an ellipsis as a dot', () => {
    expect(spokenText('wait...what')).toBe('wait...what');
    expect(spokenText('so…yes')).toBe('so…yes');
    expect(spokenText('Well... ok')).toBe('Well... ok');
  });

  it('speaks a slash in path-like words', () => {
    expect(spokenText('Run /usr/bin now')).toBe('Run slash usr slash bin now');
    expect(spokenText('a/b/c')).toBe('a slash b slash c');
    expect(spokenText('src/x.ts')).toBe('src slash x dot ts');
    expect(spokenText('(/etc)')).toBe('(slash etc)');
  });

  it('leaves a slash alone in words that are not path-like', () => {
    expect(spokenText('Tea and/or coffee, 24/7, at 50 km/h.')).toBe('Tea and/or coffee, 24/7, at 50 km/h.');
  });

  it('speaks a leading ~/ as home', () => {
    expect(spokenText('~/notes/todo.md')).toBe('home slash notes slash todo dot md');
    expect(spokenText('(~/notes)')).toBe('(home slash notes)');
  });

  it('turns - and _ into word breaks in paths and dotted words, but not in prose', () => {
    expect(spokenText('Edit issue-tracker.md and my_file.py.')).toBe('Edit issue tracker dot md and my file dot py.');
    expect(spokenText('A well-known snake_case name.')).toBe('A well-known snake_case name.');
  });

  it('drops a URL scheme and reads the rest', () => {
    expect(spokenText('https://github.com/acme/repo')).toBe('github dot com slash acme slash repo');
    expect(spokenText('(see http://example.com)')).toBe('(see example dot com)');
  });

  it('reads a scheme with nothing after it instead of dropping it', () => {
    expect(spokenText('Prefix with https:// first')).toBe('Prefix with https: slash slash first');
  });

  it('speaks @ in an email as at', () => {
    expect(spokenText('Mail name@example.com.')).toBe('Mail name at example dot com.');
    expect(spokenText('Ping @alice now')).toBe('Ping @alice now');
  });

  it('applies only the dot rule to a backslash path', () => {
    expect(spokenText('Open C:\\Users\\me\\notes.txt now')).toBe('Open C:\\Users\\me\\notes dot txt now');
  });
});
