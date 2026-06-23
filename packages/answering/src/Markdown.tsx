import { Fragment, type ReactNode } from 'react';
import {
  parseInline,
  parseMarkdown,
  type Block,
  type InlineNode,
  type ListItem,
} from './markdownParser';
import styles from './Markdown.module.css';

/**
 * The ONE shared rich-text renderer for AI prose (34-rich-text-rendering). Renders the curated, safe
 * Markdown subset (§3.1) to semantic, design-token-styled elements. Lives in @selfos/answering so the
 * Electron renderer, the iOS WebView, and the relay Worker page all share one implementation (the
 * Electron design-system re-exports it). The model never produces raw HTML/images that reach the DOM —
 * the parser guarantees that structurally (see markdownParser.ts), so this is safe for untrusted model
 * output.
 *
 * - Block mode (default): paragraphs, headings, lists, blockquotes, thematic breaks.
 * - Inline mode (`inline`): emphasis + inline code only — for short structured strings (facts, §3.6) that
 *   must never become a heading or list.
 *
 * Callers must strip coach/field markers BEFORE passing text (order matters, §7).
 */
export function Markdown({
  children,
  inline = false,
  tone,
  size,
  className,
}: {
  children: string;
  inline?: boolean | undefined;
  tone?: 'primary' | 'secondary' | undefined;
  size?: 'sm' | 'base' | undefined;
  className?: string | undefined;
}): JSX.Element | null {
  const src = children ?? '';
  const modifier = [
    tone ? styles[`tone-${tone}`] : undefined,
    size ? styles[`size-${size}`] : undefined,
    className,
  ];

  if (inline) {
    if (src.trim() === '') return null;
    return <span className={cx(styles.inline, ...modifier)}>{renderInline(parseInline(src))}</span>;
  }

  const blocks = parseMarkdown(src);
  if (blocks.length === 0) return null;
  return (
    <div className={cx(styles.markdown, ...modifier)}>
      {blocks.map((block, idx) => (
        <Fragment key={idx}>{renderBlock(block)}</Fragment>
      ))}
    </div>
  );
}

function cx(...classes: (string | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

function renderInline(nodes: InlineNode[]): ReactNode {
  return nodes.map((node, idx) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={idx}>{node.value}</Fragment>;
      case 'strong':
        return <strong key={idx}>{renderInline(node.children)}</strong>;
      case 'em':
        return <em key={idx}>{renderInline(node.children)}</em>;
      case 'code':
        return (
          <code key={idx} className={styles.code}>
            {node.value}
          </code>
        );
      // Neutered link (§11): styled, non-navigating, not in the tab order — no href ever rendered.
      case 'link':
        return (
          <span key={idx} className={styles.link}>
            {node.text}
          </span>
        );
      default:
        return null;
    }
  });
}

function renderBlock(block: Block): ReactNode {
  switch (block.type) {
    case 'paragraph':
      return <p className={styles.paragraph}>{renderInline(block.children)}</p>;
    case 'heading':
      return block.level === 3 ? (
        <h3 className={styles.h3}>{renderInline(block.children)}</h3>
      ) : (
        <h4 className={styles.h4}>{renderInline(block.children)}</h4>
      );
    case 'blockquote':
      return <blockquote className={styles.blockquote}>{renderInline(block.children)}</blockquote>;
    case 'hr':
      return <hr className={styles.hr} />;
    case 'list':
      return renderList(block.ordered, block.items);
    default:
      return null;
  }
}

function renderList(ordered: boolean, items: ListItem[]): ReactNode {
  const cls = ordered ? styles.ol : styles.ul;
  const inner = items.map((item, idx) => (
    <li key={idx} className={styles.li}>
      {renderInline(item.children)}
      {item.sublist ? renderList(item.sublist.ordered, item.sublist.items) : null}
    </li>
  ));
  return ordered ? <ol className={cls}>{inner}</ol> : <ul className={cls}>{inner}</ul>;
}
