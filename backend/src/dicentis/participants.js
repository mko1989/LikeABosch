// Participant editing on a wired DICENTIS through the DCNM API (WO-106, DEC-034): pure helpers. A participant is a
// person (RegisterPerson) registered into the active meeting (PrepareParticipant2) and, optionally, assigned to a seat.
import { randomBytes } from 'node:crypto';
import { AppError } from '../lib/errors.js';

export const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';
const MAX_NAME = 100;

/** "Karin de Vries" → { FirstName: 'Karin', LastName: 'de Vries' }; one word = last name only. */
export function splitName(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) throw new AppError('VALIDATION', 'name is required');
  if (words.join(' ').length > MAX_NAME) throw new AppError('VALIDATION', `name is longer than ${MAX_NAME} characters`);
  return words.length === 1 ? { FirstName: '', LastName: words[0] } : { FirstName: words[0], LastName: words.slice(1).join(' ') };
}

/** The person's display name, as the Conference Protocol builds it (title first). */
export const personName = u => [u?.Title, u?.FirstName, u?.MiddleName, u?.LastName].filter(Boolean).join(' ');

/** A unique DICENTIS user name for a new person: "karin.de.vries", "karin.de.vries2", … */
export function userNameFor(name, taken) {
  const base = String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 40) || 'participant';
  const used = new Set([...taken].map(x => String(x).toLowerCase()));
  if (!used.has(base)) return base;
  for (let i = 2; ; i += 1) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

/** A password for a person created here: they identify at the seat, not with this password. */
export const newPassword = () => `Lb-${randomBytes(12).toString('base64url')}9`;

/** The DcnmUserPreparationInfo of a person with a new name / group, over the stored one. */
export function personUpdate(user, { name, group }) {
  const out = { ...user };
  if (name !== undefined && name !== personName(user)) Object.assign(out, splitName(name), { Title: '', MiddleName: '' });
  if (group !== undefined) out.Group = String(group ?? '').trim();
  return out;
}

/**
 * The bridge builds DCNM data classes through a constructor and refuses members no constructor takes (ClrConvert.cs).
 * DcnmUserPreparationInfo for a new person: (firstName, middleName, lastName, title, country, region, userGroupId, group).
 */
export const newUserInfo = ({ FirstName, LastName, Group = '' }, userGroupId) => ({
  FirstName, MiddleName: '', LastName, Title: '', Country: '', Region: '', UserGroupId: userGroupId, Group,
});

/** DcnmUserPreparationInfo of an existing person, the constructor with every member, so nothing is lost on update. */
export const fullUserInfo = (u, userId) => ({
  UserId: userId, FirstName: u.FirstName ?? '', MiddleName: u.MiddleName ?? '', LastName: u.LastName ?? '', Title: u.Title ?? '',
  Country: u.Country ?? '', Region: u.Region ?? '', UserGroupId: u.UserGroupId ?? EMPTY_GUID, Group: u.Group ?? '', NfcId: u.NFCId ?? u.NfcId ?? '',
  PictureUpdatedNumber: u.PictureUpdatedNumber ?? 0, UiLanguage: u.UiLanguage ?? '', HeadphoneLanguageId: u.HeadphoneLanguageId ?? EMPTY_GUID,
  Email: u.Email ?? '', AudibleBeeps: Boolean(u.AudibleBeeps),
});

/** A new meeting participant (DcnmParticipantPreparationInfo2) with the usual rights. */
export const newParticipant = (meetingId, userId) => ({
  Id: EMPTY_GUID, MeetingId: meetingId, UserId: userId, AssignedAt: EMPTY_GUID, CanDiscuss: true, CanVote: true, CanUsePriority: false,
  CanManageMeeting: false, HasSpecialPermission: false, VipType: 'None', VoteWeight: 1,
});
