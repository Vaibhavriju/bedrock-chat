import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

export default function CodeHighlight({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  return (
    <SyntaxHighlighter
      style={vscDarkPlus}
      language={language}
      PreTag="div"
      wrapLongLines={false}
      customStyle={{ maxWidth: '100%', overflowX: 'auto' }}>
      {code}
    </SyntaxHighlighter>
  );
}
