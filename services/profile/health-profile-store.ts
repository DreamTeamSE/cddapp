import { clearProfile, initDatabase, saveProfile, setJournalUser } from '../database.ts';
import { getUserDataDb } from '../user-data-db.ts';
import { createProfileRepository } from './profile-repository.ts';

export type { OnboardingState } from './profile-repository.ts';

/** On-device wiring of the profile repository: encrypted user-data.db plus the shared profile.db. */
const repository = createProfileRepository({
  userDb: getUserDataDb,
  shared: {
    save: async (profile) => {
      await initDatabase();
      await saveProfile(profile);
    },
    clear: clearProfile,
    setJournalUser,
  },
});

export const {
  getOnboardingState,
  saveOnboardingDraft,
  completeOnboarding,
  activateProfileForUser,
  deactivateProfile,
  saveProfileTabEdits,
} = repository;
