import { describe, expect, test, vi } from 'vitest';
import { handleDmMessage } from '../../src/slack/app.js';
import type { DmMessageEvent } from '../../src/slack/types.js';

const makeLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const ownerEnv = { ALLOWED_SLACK_USER_ID: 'U_OWNER' };

const baseMessage: Partial<DmMessageEvent> = {
  type: 'message',
  channel: 'D123',
  channel_type: 'im',
  user: 'U_OWNER',
  text: 'hello',
  ts: '1234567890.000100',
};

describe('handleDmMessage', () => {
  test('owner DM → handler called, reply sent', async () => {
    const onDmFromOwner = vi.fn().mockResolvedValue('echoed: hello');
    const say = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    await handleDmMessage({
      message: baseMessage,
      env: ownerEnv,
      onDmFromOwner,
      say,
      logger: logger as unknown as Parameters<typeof handleDmMessage>[0]['logger'],
    });

    expect(onDmFromOwner).toHaveBeenCalledOnce();
    expect(onDmFromOwner).toHaveBeenCalledWith('U_OWNER', 'hello');
    expect(say).toHaveBeenCalledOnce();
    expect(say).toHaveBeenCalledWith({ text: 'echoed: hello' });
  });

  test('non-owner DM → dropped, warn logged', async () => {
    const onDmFromOwner = vi.fn();
    const say = vi.fn();
    const logger = makeLogger();

    await handleDmMessage({
      message: { ...baseMessage, user: 'U_OTHER' },
      env: ownerEnv,
      onDmFromOwner,
      say,
      logger: logger as unknown as Parameters<typeof handleDmMessage>[0]['logger'],
    });

    expect(onDmFromOwner).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  test('owner in channel → dropped, debug logged', async () => {
    const onDmFromOwner = vi.fn();
    const say = vi.fn();
    const logger = makeLogger();

    await handleDmMessage({
      message: { ...baseMessage, channel_type: 'channel' },
      env: ownerEnv,
      onDmFromOwner,
      say,
      logger: logger as unknown as Parameters<typeof handleDmMessage>[0]['logger'],
    });

    expect(onDmFromOwner).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  test('thread_broadcast subtype → dropped', async () => {
    const onDmFromOwner = vi.fn();
    const say = vi.fn();
    const logger = makeLogger();

    await handleDmMessage({
      message: { ...baseMessage, subtype: 'thread_broadcast' },
      env: ownerEnv,
      onDmFromOwner,
      say,
      logger: logger as unknown as Parameters<typeof handleDmMessage>[0]['logger'],
    });

    expect(onDmFromOwner).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  test('bot_message subtype → dropped', async () => {
    const onDmFromOwner = vi.fn();
    const say = vi.fn();
    const logger = makeLogger();

    await handleDmMessage({
      message: { ...baseMessage, subtype: 'bot_message' },
      env: ownerEnv,
      onDmFromOwner,
      say,
      logger: logger as unknown as Parameters<typeof handleDmMessage>[0]['logger'],
    });

    expect(onDmFromOwner).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });
});
