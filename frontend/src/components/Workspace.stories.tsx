import type { Meta } from '@storybook/react-vite';
import { SWRConfig } from 'swr';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AppContent from '../layouts/AppContent';
import ChatPage from '../pages/ChatPage';

export default {
  title: 'Workspace/Modern chat',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

// Preview-only synthetic configuration. No credentials, auth bypass or live APIs.
export const NewConversation = () => (
  <SWRConfig
    value={{
      provider: () => new Map(),
      isPaused: () => true,
      fallback: {
        'config/global': {
          globalAvailableModels: [
            'claude-v4.6-sonnet',
            'claude-v4.6-opus',
            'claude-v4.5-haiku',
            'amazon-nova-2-lite',
          ],
          defaultModel: 'claude-v4.6-sonnet',
          titleModel: 'claude-v4.5-haiku',
        },
      },
    }}>
    <MemoryRouter>
      <Routes>
        <Route element={<AppContent />}>
          <Route path="/" element={<ChatPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  </SWRConfig>
);
