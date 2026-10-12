// WO-115: DCNM data classes cut to a constructor, as the dicentis-bridge builds them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toConstructor } from '../src/dcnm/shape.js';

test('a seat as read (with read-only members) becomes its largest fitting constructor', () => {
  const read = {
    Id: 's1', Name: 'Seat 1', AreaId: 'a', VisType: 'None', CanDiscuss: true, CanManageMeeting: false, CanUsePriority: false,
    HasLanguageDistributionLicense: false, HasVotingLicense: false, HasIdentificationLicense: false, CameraId: 'c', PrepositionId: 0,
    SeatType: 'ParticipantSeat', Attributes: [], SeatNumber: 1, HasSpecialPermission: false, DanteOut: 'DanteOutEnabledAlways', Headroom: -6,
    HasVotingLicense2: 'LicenseAbsent', HasLanguageDistributionLicense2: 'LicenseAbsent', HasIdentificationLicense2: 'LicenseAbsent',
  };
  const out = toConstructor('DcnmSeatConfigurationInfo', read);
  assert.equal(Object.keys(out).length, 18);
  assert.equal(out.DanteOut, 'DanteOutEnabledAlways');
  assert.equal(out.HasVotingLicense2, undefined);
});

test('meeting language: the read-only headroom limits are left out', () => {
  const out = toConstructor('DcnmMeetingLanguageInfo', {
    MeetingId: 'm', LanguageId: 'l', LanguageSourceType: 'Dicentis', OutputToDante: false, OrderNumber: 1, Stream2Enable: true,
    Stream2Headroom: -6, Stream2OutputToDante: false, Stream2FloorFill: false, MinimumStream2Headroom: -20, MaximumStream2Headroom: 0,
  });
  assert.deepEqual(Object.keys(out).sort(), ['LanguageId', 'LanguageSourceType', 'MeetingId', 'OrderNumber', 'OutputToDante', 'Stream2Enable', 'Stream2FloorFill', 'Stream2Headroom', 'Stream2OutputToDante']);
});

test('names are matched case-insensitively; a missing constructor member is an error naming it', () => {
  assert.deepEqual(toConstructor('DcnmParticipantSeatAssignmentInfo', { participantId: 'p', seatId: 's' }), { participantId: 'p', seatId: 's' });
  assert.throws(() => toConstructor('DcnmLanguageInfo', { Abbreviation: 'SV', ShortAbbreviation: 'sv', EnLabel: 'Swedish', OrgLabel: 'Svenska' }), /missing userDefined, orderId/);
  assert.throws(() => toConstructor('DcnmNope', {}), /Unknown DCNM class/);
});
