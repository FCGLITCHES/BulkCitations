import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from './components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';

const styleOptions = [
  { value: 'APA', label: 'APA' },
  { value: 'MLA', label: 'MLA' },
  { value: 'Harvard', label: 'Harvard' },
  { value: 'Chicago', label: 'Chicago' },
  { value: 'IEEE', label: 'IEEE' },
  { value: 'Vancouver', label: 'Vancouver' },
];

export default function App() {
  const [references, setReferences] = useState('');
  const [inputStyle, setInputStyle] = useState('auto');
  const [outputStyle, setOutputStyle] = useState('APA');

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Conversion failed');
      return response.json();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const refs = references
      .split('\n')
      .map(r => r.trim())
      .filter(Boolean);
    if (!refs.length) return;
    mutation.mutate({
      references: refs,
      inputStyle,
      outputStyle,
    });
  };

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Citation Converter</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          className="w-full border rounded p-2 min-h-[120px]"
          placeholder="Paste references here, one per line"
          value={references}
          onChange={e => setReferences(e.target.value)}
        />
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-sm mb-1">Input Style</label>
            <select
              className="w-full border rounded p-2"
              value={inputStyle}
              onChange={e => setInputStyle(e.target.value)}
            >
              <option value="auto">Auto</option>
              {styleOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm mb-1">Output Style</label>
            <select
              className="w-full border rounded p-2"
              value={outputStyle}
              onChange={e => setOutputStyle(e.target.value)}
            >
              {styleOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Converting...' : 'Convert'}
        </Button>
      </form>
      {mutation.isError && (
        <div className="text-red-600 mt-4">{(mutation.error as Error).message}</div>
      )}
      {mutation.data && (
        <div className="mt-6">
          <h2 className="font-semibold mb-2">Converted References:</h2>
          {mutation.data.results.length === 0 && <div className="text-gray-500">No results.</div>}
          <ul className="space-y-2">
            {mutation.data.results.map((r: any, i: number) => (
              <li key={i} className="bg-gray-100 rounded p-2">
                <div className="text-sm">{r.convertedText}</div>
              </li>
            ))}
          </ul>
          {mutation.data.errors.length > 0 && (
            <div className="mt-4 text-red-600">
              <div>Errors:</div>
              <ul className="list-disc ml-6">
                {mutation.data.errors.map((e: any, i: number) => (
                  <li key={i}>{e.reference}: {e.error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
