import { FunctionComponent, useState, useCallback, useEffect } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Highlight, themes, Language, Prism } from 'prism-react-renderer'

// Add C# support to Prism
;(typeof globalThis !== 'undefined' ? globalThis : window).Prism = Prism
import('prismjs/components/prism-csharp')

interface MarkdownRendererProps {
  content: string
  className?: string
}

// Copy button - icon only
const CopyButton: FunctionComponent<{ code: string }> = ({ code }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [code])

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded transition-colors text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-white/10"
      aria-label={copied ? 'Copied!' : 'Copy code'}
    >
      {copied ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}

// Code block header with language and copy button
const CodeBlockHeader: FunctionComponent<{ language: string; code: string }> = ({
  language,
  code,
}) => (
  <div className="flex items-center justify-between px-4 py-2 bg-black/20 border-b border-vscode-widget-border/30">
    <span className="text-sm text-vscode-descriptionForeground">
      {language}
    </span>
    <CopyButton code={code} />
  </div>
)

export const MarkdownRenderer: FunctionComponent<MarkdownRendererProps> = ({
  content,
  className = '',
}) => {
  return (
    <div className={`markdown-renderer text-sm leading-relaxed text-vscode-foreground ${className}`}>
      <style>{`
        .markdown-renderer a:hover {
          text-decoration-thickness: 2px !important;
        }
        .markdown-renderer tbody tr:hover {
          background-color: rgba(128, 128, 128, 0.08) !important;
        }
      `}</style>

      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Inline code
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '')
            const codeString = String(children).replace(/\n$/, '')

            // Block code (has language or is multiline)
            if (match || codeString.includes('\n')) {
              const language = match ? match[1] : 'text'

              return (
                <div className="code-block-wrapper my-4 rounded-lg overflow-hidden border border-vscode-widget-border/30 bg-black/15">
                  <CodeBlockHeader language={language} code={codeString} />
                  <Highlight
                    theme={themes.vsDark}
                    code={codeString}
                    language={language as Language}
                  >
                    {({ tokens, getLineProps, getTokenProps }) => (
                      <pre
                        className="overflow-x-auto"
                        style={{
                          margin: 0,
                          padding: '16px',
                          fontSize: '14px',
                          lineHeight: '1.6',
                          fontFamily: 'var(--vscode-editor-font-family, "Fira Code", "Cascadia Code", Consolas, monospace)',
                        }}
                      >
                        <code>
                          {tokens.map((line, i) => (
                            <div key={i} {...getLineProps({ line })}>
                              {line.map((token, key) => (
                                <span key={key} {...getTokenProps({ token })} />
                              ))}
                            </div>
                          ))}
                        </code>
                      </pre>
                    )}
                  </Highlight>
                </div>
              )
            }

            // Inline code - matches example Markdown.tsx style
            return (
              <code
                {...props}
                className="relative rounded bg-vscode-textCodeBlock-background px-1.5 py-0.5 font-mono text-sm font-semibold"
              >
                {children}
              </code>
            )
          },

          // Code snippet wrapper - matches example pattern
          pre: ({ children, ...props }: any) => <>{children}</>,

          // Paragraphs - matches example with whitespace handling
          p: ({ children, ...props }) => (
            <div
              {...props}
              className="leading-7 [&:not(:first-child)]:mt-4 whitespace-pre-wrap break-words"
              role="article"
            >
              {children}
            </div>
          ),

          // Headings - matches example Markdown.tsx style
          h1: ({ children, ...props }) => (
            <h1
              {...props}
              className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl mt-8 first:mt-0 text-vscode-foreground"
            >
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2
              {...props}
              className="scroll-m-20 border-b border-vscode-widget-border pb-2 text-3xl font-semibold tracking-tight mt-8 first:mt-0 text-vscode-foreground"
            >
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3
              {...props}
              className="scroll-m-20 text-2xl font-semibold tracking-tight mt-6 first:mt-0 text-vscode-foreground"
            >
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4
              {...props}
              className="scroll-m-20 text-xl font-semibold tracking-tight mt-6 first:mt-0 text-vscode-foreground"
            >
              {children}
            </h4>
          ),

          // Lists - matches example Markdown.tsx style
          ul: ({ children, ...props }) => (
            <ul
              {...props}
              className="my-3 ml-3 list-disc pl-2 [&>li]:mt-1"
            >
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol
              {...props}
              className="my-3 ml-3 list-decimal pl-2 [&>li]:mt-1"
            >
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li
              {...props}
              className="leading-7 text-vscode-foreground"
            >
              {children}
            </li>
          ),

          // Blockquote - matches example style
          blockquote: ({ children, ...props }) => (
            <blockquote
              {...props}
              className="mt-6 border-l-2 border-vscode-textLink-foreground pl-6 italic text-vscode-textBlockQuote-foreground"
            >
              {children}
            </blockquote>
          ),

          // Links - matches example style
          a: ({ href, children, ...props }) => (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-vscode-textLink-foreground hover:underline"
            >
              {children}
            </a>
          ),

          // Horizontal rule
          hr: ({ ...props }) => (
            <hr
              {...props}
              className="my-6 border-none h-px bg-vscode-widget-border"
            />
          ),

          // Tables - subtle gray borders
          table: ({ children, ...props }) => (
            <div className="my-4 rounded-md overflow-hidden"
              style={{ border: '1px solid rgba(128, 128, 128, 0.2)' }}
            >
              <div className="overflow-x-auto">
                <table
                  {...props}
                  className="w-full text-sm"
                >
                  {children}
                </table>
              </div>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead
              {...props}
              style={{
                backgroundColor: 'rgba(128, 128, 128, 0.1)',
                borderBottom: '1px solid rgba(128, 128, 128, 0.2)',
              }}
            >
              {children}
            </thead>
          ),
          th: ({ children, ...props }) => (
            <th
              {...props}
              className="h-8 px-3 text-left align-middle font-medium text-vscode-foreground text-xs"
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td
              {...props}
              className="px-3 py-2 align-middle text-vscode-foreground"
            >
              {children}
            </td>
          ),
          tr: ({ children, ...props }) => (
            <tr
              {...props}
              className="transition-colors"
              style={{ borderBottom: '1px solid rgba(128, 128, 128, 0.15)' }}
            >
              {children}
            </tr>
          ),
          tbody: ({ children, ...props }) => (
            <tbody {...props} className="[&_tr:last-child]:border-0" style={{ background: 'transparent' }}>
              {children}
            </tbody>
          ),

          // Strikethrough
          del: ({ children, ...props }) => (
            <del
              {...props}
              className="text-vscode-descriptionForeground"
            >
              {children}
            </del>
          ),

          // Strong/bold - matches example style
          strong: ({ children, ...props }) => (
            <span {...props} className="font-bold">
              {children}
            </span>
          ),

          // Emphasis/italic - matches example style
          em: ({ children, ...props }) => (
            <span {...props} className="italic">
              {children}
            </span>
          ),

          // Images with shadow and rounded corners
          img: ({ src, alt, ...props }) => (
            <div className="sm:max-w-sm md:max-w-md">
              <img
                {...props}
                src={src}
                alt={alt}
                className="w-full h-auto rounded-md border border-vscode-widget-border shadow-md"
              />
            </div>
          ),

          // Task list checkboxes
          input: ({ type, checked, ...props }) => {
            if (type === 'checkbox') {
              return (
                <input
                  {...props}
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="w-4 h-4 mr-2 accent-vscode-textLink-foreground cursor-default"
                />
              )
            }
            return <input {...props} type={type} />
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
