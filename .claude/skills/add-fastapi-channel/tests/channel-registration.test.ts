import { describe, it, expect } from 'vitest';
import { getRegisteredChannelNames } from '../../../../src/channels/registry.js';

describe('FastAPI Channel Skill Integration', () => {
  it('should register HTTP channel in registry', () => {
    // Import to trigger self-registration
    import('../../../../src/channels/index.js');
    
    const channels = getRegisteredChannelNames();
    expect(channels).toContain('http');
  });
});
