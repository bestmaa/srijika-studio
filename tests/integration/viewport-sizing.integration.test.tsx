import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppearanceProvider } from '../../apps/studio/src/app/AppearanceProvider';
import { DesignFrame } from '../../apps/studio/src/components/DesignFrame';
import { TopBar } from '../../apps/studio/src/components/TopBar';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

describe('design viewport sizing', () => {
  beforeEach(() => {
    useStudioStore.setState({ viewport: 'desktop', customViewportSize: null });
  });

  afterEach(() => {
    useStudioStore.setState({ viewport: 'desktop', customViewportSize: null });
  });

  it('uses exact preset and custom iframe dimensions', () => {
    const { container } = render(
      <AppearanceProvider>
        <DesignFrame />
      </AppearanceProvider>,
    );
    const frame = container.querySelector<HTMLElement>('.device-frame');
    const iframe = screen.getByTestId('design-iframe');

    expect(frame).toHaveStyle({ width: '1180px' });
    expect(frame).toHaveAttribute('data-viewport-width', '1180');
    expect(frame).toHaveAttribute('data-viewport-height', '820');
    expect(iframe).toHaveAttribute('width', '1180');
    expect(iframe).toHaveAttribute('height', '820');
    expect(iframe).toHaveStyle({ height: '820px' });

    act(() => useStudioStore.getState().setViewport('mobile'));
    expect(frame).toHaveStyle({ width: '390px' });
    expect(iframe).toHaveAttribute('width', '390');
    expect(iframe).toHaveAttribute('height', '844');

    act(() => useStudioStore.getState().setCustomViewportSize(960, 540));
    expect(frame).toHaveStyle({ width: '960px' });
    expect(iframe).toHaveAttribute('width', '960');
    expect(iframe).toHaveAttribute('height', '540');
    expect(screen.getByText('custom')).toBeInTheDocument();
  });

  it('applies manual dimensions and lets a preset clear the custom override', () => {
    render(<TopBar />);
    fireEvent.change(screen.getByLabelText('Viewport width'), { target: { value: '1440' } });
    fireEvent.change(screen.getByLabelText('Viewport height'), { target: { value: '900' } });
    fireEvent.click(screen.getByTitle('Apply custom viewport size'));

    expect(useStudioStore.getState().customViewportSize).toEqual({ width: 1440, height: 900 });

    fireEvent.click(screen.getByTitle('Tablet'));
    expect(useStudioStore.getState().viewport).toBe('tablet');
    expect(useStudioStore.getState().customViewportSize).toBeNull();
  });
});
