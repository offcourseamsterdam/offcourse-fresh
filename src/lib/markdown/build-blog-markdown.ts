import { buildFrontmatter } from './frontmatter'
import { htmlToMarkdown } from './html-to-markdown'

export interface BlogMarkdownPost {
  title: string
  /** Plain text, tags already stripped (e.g. via stripTags on the WP excerpt). */
  description: string
  /** Raw WordPress content.rendered HTML — converted to Markdown here. */
  contentHtml: string
  image: string | null
  date: string
  url: string
}

/** Renders a WordPress blog post's markdown-for-agents representation. */
export function buildBlogMarkdown(post: BlogMarkdownPost): string {
  const body = htmlToMarkdown(post.contentHtml)

  return [
    buildFrontmatter({
      title: post.title,
      description: post.description || undefined,
      image: post.image,
      date: post.date,
    }),
    '',
    `# ${post.title}`,
    '',
    body,
    '',
    '---',
    '',
    `[Read on the website](${post.url})`,
  ].join('\n')
}
