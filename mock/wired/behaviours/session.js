import { ALL_PERMISSIONS } from '../state.js';

export default {
  GetPermissions: ({ state, user }) => ({ permissions: state.userPermissions[user] ?? ALL_PERMISSIONS }),
  GetParticipantAccessDeniedReasons: ({ state }) => ({
    participantAccessDeniedReasonsInfo: { accessDeniedReasons: state.accessDeniedReasons ?? [] },
  }),
  GetRoomName: ({ state }) => ({ roomName: state.roomName }),
  GetRoomContactEmail: ({ state }) => ({ roomContactEmail: state.roomContactEmail }),
};
