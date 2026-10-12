# Bosch Discussion Systems

This module shows and controls the meeting in a Bosch discussion system: who is speaking, who is waiting to speak, and the state of the microphones, power, volume, voting and interpreter desks. Use the buttons to switch microphones, clear requests or set the system. The buttons show the state with colours, and the variables give the names for your own text.

The module talks to the system over its network API. It does not need a bridge for these systems.

Supported systems:

- DICENTIS (wired)
- DICENTIS Wireless (WAP)
- CCS 1000 D
- DCN Next Generation (read-only)

## Configuration

Choose the system first. The other fields change to what that system needs.

### DICENTIS

- Address: the IP address or host name of the DICENTIS server.
- Port: 31416 (leave empty for the default). The server's self-signed certificate is accepted.
- User name and password: a DICENTIS user with the rights you need: manage meeting (for the microphones), system power, master volume and interpretation.

The module receives changes as events from the server, so it does not poll.

### DICENTIS Wireless and CCS 1000 D

- Address: the IP address or host name of the access point (WAP) or the control unit (CCSD-CU).
- Port: 80 (leave empty for the default). Tick HTTPS if the device uses it.
- User name and password: create a separate user for Companion. The device allows one session per user. If the same user is also logged in to the web app, one of them is logged out.
- Take over the session: tick this to take the session over from another login of the same user. Leave it off if you want Companion to stop when someone else logs in with that user.

The module keeps a long-poll request open for each live resource (seats, speakers, waiting list, power and, on DICENTIS Wireless, voting): the device answers as soon as something changes. If the connection drops, it reconnects by itself.

### DCN Next Generation

- Read-only: the module receives the meeting data stream from the DCN-SW server PC.
- Address: the DCN-SW server PC. Port: 20000.
- Add this computer to `AllowedClients` in the DCN-SW `Server.exe.config`.
- The CCU needs the DCN-SWSMD licence.
- There are feedbacks and variables, but no actions.

The DCN control API (which needs a Windows bridge) is in the separate "LikeABosch" module.

## Seats

Actions take a seat in one of three ways. The module tries them in this order:

1. The seat id.
2. The seat name (not case sensitive).
3. The seat number: 1 is the first seat.

Pick a seat from the list, or type one of these in the box.

## Actions

| Action | DICENTIS | DICENTIS Wireless | CCS 1000 D |
| --- | :---: | :---: | :---: |
| Seat: microphone (toggle, on, off) | yes | yes | yes |
| Seat: mute / unmute a speaker | yes | | |
| Seat: request to speak (toggle, add, remove) | remove only | yes | yes |
| Seat: chairman priority (toggle, on, off) | | yes | yes |
| Next speaker (first request gets the floor) | yes | yes | yes |
| All microphones off (requests stay) | yes | yes | yes |
| Clear all requests | yes | yes | yes |
| Clear the discussion (speakers and requests) | yes | yes | yes |
| System power (on, standby, off) | on, off | on, standby, off | on, standby |
| Master volume (set to, up by, down by) | yes | | |
| Voting: open / hold / close | | yes | |
| Seat: microphone sensitivity (dB) | | | yes |
| All microphone sensitivities back to 0 dB | | | yes |
| Interpreter desk: microphone (off, output A, B or C) | yes | | |

The DCN Next Generation has no actions.

## Feedbacks

| Feedback | What it shows | Systems |
| --- | --- | --- |
| Seat: microphone state | A seat is speaking (on or muted), on, muted, waiting to speak, or off | all |
| Seat: chairman priority active | A seat has chairman priority | all |
| Somebody is speaking | At least one speaker | all |
| Somebody is waiting to speak | At least one request | all |
| System power | The system is in the chosen power state | DICENTIS, Wireless, CCS 1000 D |
| Voting state | Voting is open, hold or closed | Wireless |
| Interpreter desk: microphone on | An interpreter desk microphone is on | DICENTIS |

## Variables

| Variable | Value |
| --- | --- |
| `connection` | Connection state |
| `system` | The system name |
| `speakers` | Number of speakers |
| `requests` | Number of requests |
| `speaker_names` | Speakers, names separated by commas |
| `request_names` | Requests, names separated by commas |
| `latest_speaker_seat` | Latest speaker: seat name |
| `latest_speaker_person` | Latest speaker: person |
| `latest_speaker_name` | Latest speaker: person, or the seat name if there is no person |
| `latest_speaker_id` | Latest speaker: seat id |
| `first_request_seat` | First request: seat name |
| `first_request_person` | First request: person |
| `first_request_name` | First request: person, or the seat name if there is no person |
| `speaker_1_seat` to `speaker_4_seat` | Speaker 1 to 4: seat name |
| `speaker_1_name` to `speaker_4_name` | Speaker 1 to 4: person, or the seat name |
| `power` | System power |
| `master_volume` | Master volume |
| `voting` | Voting state |
| `seat_<id>_name` | Seat name |
| `seat_<id>_person` | Seat person |
| `seat_<id>_mic` | Seat microphone: on, muted, request or off |

`<id>` is the seat id with every character other than a letter, a digit or `_` replaced by `_`. For example, seat id `seat-3` gives `seat_seat_3_name`.

## Presets

The presets are grouped by category. A preset shows only the buttons that the chosen system supports.

- **Seats**: one button per seat (up to 200). It toggles the seat's microphone, and its colour shows the state: red for an open microphone, amber for a muted speaker, green for a request.
- **Discussion**: next speaker, all mics off, clear requests, clear discussion, the latest speaker, and the number of speakers and requests.
- **System**: power buttons, voting open / hold / close, volume up and down with the current volume, and the sensitivity reset (CCS 1000 D).
- **Interpretation**: for each interpreter desk, a button for its microphone on output A and a button to switch it off (DICENTIS).

## Other products

The DCN control API (which needs a Windows bridge) is in the separate "LikeABosch" module.
