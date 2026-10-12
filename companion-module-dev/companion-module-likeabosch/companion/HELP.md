# LikeABosch

This module controls the Bosch system that LikeABosch is connected to: DICENTIS (wired), DICENTIS Wireless, CCS 1000 D and DCN. It works through LikeABosch, so LikeABosch must be running on a PC on the network. The module gets live changes from LikeABosch, so the buttons update at once.

Through LikeABosch, the module also reaches what LikeABosch reaches through its Windows bridges: the full DICENTIS API (dicentis-bridge) and the DCN-SW API for DCN control (dcn-bridge).

## When to use this module

- Use this module when LikeABosch runs in the same meeting setup, or on a PC in the network, and you want its bridge features or the camera director.
- Use the "Bosch Discussion Systems" module when you want to connect to the system directly. It uses the network APIs only and does not need LikeABosch.

## Setup

1. Start LikeABosch and connect it to the Bosch system.
2. In this module, enter the **LikeABosch address**. The default is `127.0.0.1` (the same PC as LikeABosch).
3. Enter the **web port**. The default is `3000`. Use the port set in the LikeABosch launcher if it is different.

If Companion runs on another PC, turn on **LAN access** in the LikeABosch launcher. Then enter the address of the LikeABosch PC.

The module needs a LikeABosch version with the quick-actions API. If the status says "no quick-actions API", update LikeABosch.

## Status

| Status | Meaning |
| --- | --- |
| OK (green) | LikeABosch is running and connected to the Bosch system. |
| Warning (yellow) | LikeABosch runs but is not connected to a Bosch system. The message shows the connection state. |
| Connection failure (red) | The module cannot reach LikeABosch at the address and port. It tries again by itself. |
| Bad config | The address is empty, or the LikeABosch version is too old. |

## Seats

Actions and feedbacks take a seat in one of three ways. The module tries them in this order:

1. The seat **id**, for example `seat-3` on wired systems and `3` on wireless systems.
2. The seat **name**, not case sensitive, for example `Chairman` or `Seat 4`.
3. The seat **number**: 1 is the first seat in the list.

Pick a seat from the list, or type one of these in the box. Use the id or the name for buttons that must not change when the seat list changes. The number follows the seat list.

## Actions

Seat actions:

| Action | What it does |
| --- | --- |
| Seat: microphone | Microphone on, off or toggle for a seat. |
| Seat: request to speak | Adds or removes a request for a seat (on, off or toggle). Not supported on wired DICENTIS. |
| Seat: chairman priority | Gives a speaking seat chairman priority, or removes it (on, off or toggle). |

Discussion actions:

| Action | What it does |
| --- | --- |
| Next speaker (first request gets the floor) | The first seat in the request queue gets the floor. |
| All microphones off (requests stay) | Every speaker is switched off. Requests are kept. |
| Clear all requests | Removes every request. |
| Clear the discussion | Removes all speakers and requests. |

Camera actions:

| Action | What it does |
| --- | --- |
| Cameras: show a seat / the overview | Shows the camera on a seat. An empty seat shows the overview. |
| Cameras: automation on / off | Turns the camera director's automation on, off or toggles it. |

Raw API actions. These send a request to LikeABosch, which passes it on. Use them when the other actions do not cover what you need. Check the LikeABosch documentation for the methods and their arguments.

| Action | What it does | Example |
| --- | --- | --- |
| DICENTIS API call (via the dicentis-bridge) | Calls a DICENTIS API method. Interface, method and arguments (JSON object). | Interface `ControlMeeting`, method `RequestActiveMeetingStatusAsync`, arguments `{}` |
| DCN-SW API call (via the dcn-bridge) | Calls a DCN-SW API method. API, method and arguments (JSON object). | API `control.DiscussionApi`, method `SpeakNow`, arguments `{"participantId":0,"seatId":3}` |
| LikeABosch API request (any endpoint) | Sends any request to a LikeABosch endpoint. Method, path and optional body (JSON). | `PUT` `/api/domain/power`, body `{"state":"standby"}` |

The arguments and the body can use Companion variables.

## Feedbacks

| Feedback | What it shows |
| --- | --- |
| Seat: microphone state | A seat is speaking (on or muted), has its microphone on, is muted, is waiting, or is off. Pick the state in the options. |
| Seat: chairman priority active | A seat has chairman priority. |
| Somebody is speaking | At least one seat is a speaker. |
| Somebody is waiting to speak | At least one seat is in the request queue. |
| LikeABosch is connected to the Bosch system | LikeABosch has a session with the Bosch system. |

## Variables

| Variable | Value |
| --- | --- |
| `connection` | Connection to LikeABosch |
| `system` | Name of the Bosch system |
| `system_state` | Connection state of the Bosch system |
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
| `seat_<id>_name` | Seat name |
| `seat_<id>_person` | Seat person |
| `seat_<id>_mic` | Seat microphone: on, muted, request or off |

`<id>` is the seat id with every character other than a letter, a digit or `_` replaced by `_`. For example, seat id `seat-3` gives `seat_seat_3_name`. The per-seat variables exist for the seats that are in the list when the module starts or the seat list changes.

## Presets

- **Seats**: one button per seat (up to 200). It toggles the seat's microphone. Red means the microphone is on, amber means muted, green means the seat is waiting.
- **Discussion**: next speaker, all microphones off, clear requests, clear discussion, the latest speaker, and the number of speakers and requests.
- **Cameras**: overview, and camera automation on or off.
- **System**: the name of the Bosch system, lit when LikeABosch is connected to it.
