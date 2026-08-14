import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { StudioApp } from '../../apps/studio/src/app/StudioApp';
import { APPEARANCE_STORAGE_KEY } from '../../apps/studio/src/lib/appearance';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

describe('Settings appearance editor', () => {
  beforeEach(() => {
    useStudioStore.getState().resetDocument();
  });

  it('starts in Srijika dark and exposes accessible System, Light, and Dark choices', async () => {
    render(<StudioApp />);

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute('data-studio-color-scheme', 'dark'),
    );
    expect(document.documentElement.style.getPropertyValue('--studio-background')).toBe('#111111');
    expect(document.documentElement.style.getPropertyValue('--studio-foreground')).toBe('#fcfcfc');
    expect(document.documentElement.style.getPropertyValue('--studio-accent')).toBe('#77767b');

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /System/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /Light/ })).toHaveAttribute('aria-checked', 'false');
    const darkChoice = screen.getByRole('radio', { name: /Dark/ });
    const lightChoice = screen.getByRole('radio', { name: /Light/ });
    expect(darkChoice).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Theme preset')).toHaveValue('srijika');
    expect(screen.getByLabelText('Theme preset')).toHaveDisplayValue('Srijika');
    expect(screen.queryByRole('option', { name: 'Codex' })).not.toBeInTheDocument();

    await waitFor(() => expect(darkChoice).toHaveFocus());
    fireEvent.keyDown(darkChoice, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(lightChoice).toHaveAttribute('aria-checked', 'true');
      expect(lightChoice).toHaveFocus();
    });
  });

  it('keeps controlled text fields mounted and focused while typing', async () => {
    const user = userEvent.setup();
    render(<StudioApp />);
    await user.click(screen.getByRole('button', { name: 'Open settings' }));

    const accent = screen.getByLabelText('Accent');
    await user.click(accent);
    await user.keyboard('{Control>}a{/Control}#123456');
    expect(accent).toHaveValue('#123456');
    expect(accent).toHaveFocus();

    const uiFont = screen.getByLabelText('UI font');
    await user.click(uiFont);
    await user.keyboard('{Control>}a{/Control}Audit Font');
    expect(uiFont).toHaveValue('Audit Font');
    expect(uiFont).toHaveFocus();
  });

  it('live-applies and persists Light, System, custom colors, fonts, translucency, and contrast', async () => {
    const initialRevision = useStudioStore.getState().document.revision;
    const view = render(<StudioApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    fireEvent.click(screen.getByRole('radio', { name: /Light/ }));
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute('data-studio-color-scheme', 'light'),
    );
    expect(document.documentElement.style.getPropertyValue('--studio-background')).toBe('#f7f7f8');

    const accent = screen.getByLabelText('Accent');
    fireEvent.change(accent, { target: { value: '#229955' } });
    fireEvent.blur(accent);
    const uiFont = screen.getByLabelText('UI font');
    fireEvent.change(uiFont, { target: { value: 'Arial, sans-serif' } });
    fireEvent.blur(uiFont);
    const codeFont = screen.getByLabelText('Code font');
    fireEvent.change(codeFont, {
      target: { value: 'Consolas, monospace' },
    });
    fireEvent.blur(codeFont);
    fireEvent.click(screen.getByRole('switch', { name: 'Translucent sidebar' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Contrast' }), {
      target: { value: '68' },
    });

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--studio-accent')).toBe('#229955');
      expect(document.documentElement.style.getPropertyValue('--studio-ui-font')).toBe(
        'Arial, sans-serif',
      );
      expect(document.documentElement).toHaveAttribute('data-studio-translucent-sidebar', 'false');
    });
    expect(screen.getByLabelText('Theme preset')).toHaveValue('custom');
    expect(screen.getByRole('slider', { name: 'Contrast' })).toHaveAttribute(
      'aria-valuetext',
      '68 percent',
    );
    expect(useStudioStore.getState().document.revision).toBe(initialRevision);

    const saved = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}') as {
      mode?: string;
      contrast?: number;
      themes?: { light?: { accent?: string } };
    };
    expect(saved.mode).toBe('light');
    expect(saved.contrast).toBe(68);
    expect(saved.themes?.light?.accent).toBe('#229955');

    view.unmount();
    render(<StudioApp />);
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--studio-accent')).toBe('#229955'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.click(screen.getByRole('radio', { name: /System/ }));
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute('data-studio-color-scheme', 'light'),
    );
  });

  it('selecting Srijika consistently selects Dark while preserving non-color preferences', async () => {
    render(<StudioApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.click(screen.getByRole('radio', { name: /Light/ }));

    const uiFont = screen.getByLabelText('UI font');
    fireEvent.change(uiFont, { target: { value: 'Arial, sans-serif' } });
    fireEvent.blur(uiFont);
    fireEvent.click(screen.getByRole('switch', { name: 'Translucent sidebar' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Contrast' }), {
      target: { value: '68' },
    });
    const accent = screen.getByLabelText('Accent');
    fireEvent.change(accent, { target: { value: '#229955' } });
    fireEvent.blur(accent);

    fireEvent.change(screen.getByLabelText('Theme preset'), { target: { value: 'srijika' } });

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Dark/ })).toHaveAttribute('aria-checked', 'true');
      expect(document.documentElement).toHaveAttribute('data-studio-color-scheme', 'dark');
    });
    expect(screen.getByLabelText('Theme preset')).toHaveValue('srijika');
    expect(document.documentElement.style.getPropertyValue('--studio-accent')).toBe('#77767b');
    expect(screen.getByLabelText('UI font')).toHaveValue('Arial, sans-serif');
    expect(screen.getByRole('switch', { name: 'Translucent sidebar' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('slider', { name: 'Contrast' })).toHaveValue('68');
  });

  it('restores the complete Srijika dark default without resetting the page document', async () => {
    render(<StudioApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.click(screen.getByRole('radio', { name: /Light/ }));
    const background = screen.getByLabelText('Background');
    fireEvent.change(background, { target: { value: '#eeeeee' } });
    fireEvent.blur(background);
    const documentBeforeReset = useStudioStore.getState().document;

    fireEvent.click(screen.getByRole('button', { name: 'Reset defaults' }));

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute('data-studio-color-scheme', 'dark'),
    );
    expect(document.documentElement.style.getPropertyValue('--studio-background')).toBe('#111111');
    expect(document.documentElement.style.getPropertyValue('--studio-accent')).toBe('#77767b');
    expect(screen.getByText('Restored Srijika defaults')).toBeInTheDocument();
    expect(useStudioStore.getState().document).toBe(documentBeforeReset);
  });
});
