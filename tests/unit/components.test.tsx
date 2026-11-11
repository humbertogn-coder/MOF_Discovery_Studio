// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DftBadge, Num, OodBadge } from '../../src/components/ui';

describe('UI primitives', () => {
  it('Num shows an explicit missing marker for null', () => {
    const { container } = render(<Num v={null} unit="eV" />);
    expect(container.textContent).toContain('—');
    expect(container.textContent).not.toContain('0');
    expect(container.textContent).not.toContain('eV');
  });
  it('Num shows zero as a value', () => {
    expect(render(<Num v={0} digits={1} />).container.textContent).toBe('0.0');
  });
  it('badges distinguish statuses', () => {
    expect(render(<DftBadge status="rejected" />).container.textContent).toBe('DFT not accepted');
    expect(render(<DftBadge status="not_available" />).container.textContent).toBe('Not evaluated');
    expect(render(<OodBadge ood={true} />).container.textContent).toBe('OOD');
    expect(render(<OodBadge ood={null} />).container.textContent).toBe('OOD unknown');
  });
});
