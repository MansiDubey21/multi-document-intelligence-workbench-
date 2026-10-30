import { useState } from 'react';

const EXAMPLES = [
  'Compare the information across all uploaded documents.',
  'Identify inconsistencies between the application form and supporting documents.',
  'Extract key dates, obligations, financial values, and missing information.',
  'Compare the financial position of the companies represented in the documents.',
  'Highlight discrepancies in names, addresses, licence details, or revenue figures.',
];

interface Props {
  onRun: (instruction: string) => void;
  running: boolean;
  selectedCount: number;
  maxChars: number;
}

export function Composer({ onRun, running, selectedCount, maxChars }: Props) {
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const tooShort = trimmed.length < 5;
  const disabled = running || tooShort || selectedCount === 0 || trimmed.length > maxChars;

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onRun(trimmed);
      }}
    >
      <label htmlFor="instruction" className="composer__label">
        What should the analysis look for?
      </label>
      <textarea
        id="instruction"
        value={text}
        maxLength={maxChars}
        rows={3}
        placeholder="For example: check that the applicant’s name, address and revenue agree across every document."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !disabled) onRun(trimmed);
        }}
      />
      <div className="examples" role="list" aria-label="Example instructions">
        {EXAMPLES.map((ex) => (
          <button type="button" role="listitem" key={ex} className="example" onClick={() => setText(ex)}>
            {ex}
          </button>
        ))}
      </div>
      <div className="composer__foot">
        <span className="muted small">
          {selectedCount === 0
            ? 'Select at least one readable document.'
            : `${selectedCount} document${selectedCount === 1 ? '' : 's'} selected · ${trimmed.length}/${maxChars}`}
        </span>
        <button type="submit" className="btn btn--primary" disabled={disabled}>
          {running ? 'Analysing…' : 'Analyse documents'}
        </button>
      </div>
    </form>
  );
}
