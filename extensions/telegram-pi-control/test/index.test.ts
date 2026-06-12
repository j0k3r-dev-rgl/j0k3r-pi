import { describe, expect, it, vi } from 'vitest';

describe('index side effects', () => {
  it('imports without loading config or creating telegram polling adapters', async () => {
    const configModule = await import('../src/config.js');
    const adapterModule = await import('../src/telegram-adapter.js');

    const loadSpy = vi.spyOn(configModule, 'loadTelegramControlConfig');
    const adapterSpy = vi.spyOn(adapterModule, 'TelegramLongPollingAdapter');

    loadSpy.mockClear();
    adapterSpy.mockClear();

    const extension = await import('../index.js');

    expect(typeof extension.default).toBe('function');
    expect(() => extension.default({})).not.toThrow();
    expect(loadSpy).not.toHaveBeenCalled();
    expect(adapterSpy).not.toHaveBeenCalled();
  });
});
