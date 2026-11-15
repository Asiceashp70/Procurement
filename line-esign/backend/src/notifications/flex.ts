/** LINE Flex Messages. Every notification carries the title, details and one action button. */

export interface CardInput {
  altText: string;
  title: string;
  color?: string;
  rows: [label: string, value: string][];
  note?: string;
  button?: { label: string; url: string };
}

export function card(input: CardInput) {
  const body: unknown[] = [
    { type: 'text', text: input.title, weight: 'bold', size: 'lg', wrap: true, color: input.color ?? '#111111' },
    {
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      spacing: 'sm',
      contents: input.rows.map(([label, value]) => ({
        type: 'box',
        layout: 'baseline',
        spacing: 'sm',
        contents: [
          { type: 'text', text: label, color: '#888888', size: 'sm', flex: 2 },
          { type: 'text', text: value || '-', wrap: true, color: '#333333', size: 'sm', flex: 5 },
        ],
      })),
    },
  ];
  if (input.note) body.push({ type: 'text', text: input.note, wrap: true, size: 'sm', color: '#555555', margin: 'lg' });
  return {
    type: 'flex',
    altText: input.altText.slice(0, 400),
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: body },
      ...(input.button
        ? {
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [{ type: 'button', style: 'primary', color: '#06C755', action: { type: 'uri', label: input.button.label, uri: input.button.url } }],
            },
          }
        : {}),
    },
  };
}
