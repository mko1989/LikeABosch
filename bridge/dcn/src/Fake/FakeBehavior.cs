// Behaviour of the --fake API (Fake.generated.cs calls into this). Just enough state to test the bridge protocol and
// the reflection paths end to end: primitives, enums, struct/class in and out, arrays, events from API threads.
// Full DCN semantics are simulated in Node by mock/dcn, not here.
using System;
using System.Collections.Generic;
using System.Threading;
using BridgeCore;

namespace DcnBridge.Fake
{
    public interface IFakeRaise { void Raise(string name, object args); }
    public interface IFakeRoot { string Group { get; } bool Available { get; set; } void RaiseAvailability(); }

    public static class FakeBehavior
    {
        static readonly object Gate = new object();
        static int volume = 15;
        static bool mute;
        static readonly List<PARTICIPANT> Speakers = new List<PARTICIPANT>();
        static DISCUSSION_INFO discussion = new DISCUSSION_INFO { NumberOfOpenMicrophones = 4, MaximumNumberOfRequests = 10, AllowMicrophoneOff = true };
        public static readonly HashSet<string> Denied = new HashSet<string>();

        public static API_ERROR Initialize(IFakeRoot root, string server, string user, string password)
        {
            if (user != "admin" || password != "admin")
            {
                Thread.Sleep(50); // the real API waits 5 s before NO_AUTHORIZATION
                return API_ERROR.NO_AUTHORIZATION;
            }
            if (!server.StartsWith("tcp://", StringComparison.Ordinal)) return API_ERROR.SETUP_LINK_FAILED;
            root.Available = true;
            // Raised from another thread, like the real API's remoting callbacks.
            ThreadPool.QueueUserWorkItem(_ => root.RaiseAvailability());
            return API_ERROR.NONE;
        }

        public static API_ERROR Terminate(IFakeRoot root)
        {
            root.Available = false;
            root.RaiseAvailability();
            return API_ERROR.NONE;
        }

        public static bool Allowed(string key) => !Denied.Contains(key);

        /// <summary>Value for an out parameter: what the behaviour put into the args array, else a neutral default.</summary>
        public static object Out(object value, Type type) => value ?? ClrConvert.DefaultFor(type);

        static void RaiseLater(object api, string name, object args) => ThreadPool.QueueUserWorkItem(_ => ((IFakeRaise)api).Raise(name, args));

        public static API_ERROR Call(object api, string key, string method, object[] a)
        {
            lock (Gate)
            {
                switch (key + "." + method)
                {
                    case "control.DcnSystemApi.GetMasterVolume": a[0] = volume; return API_ERROR.NONE;
                    case "control.DcnSystemApi.SetMasterVolume":
                        if ((int)a[0] < 0 || (int)a[0] > 30) return API_ERROR.OUT_OF_RANGE;
                        volume = (int)a[0];
                        RaiseLater(api, "masterVolumeChange", new CountEventArgs { Count = volume });
                        return API_ERROR.NONE;
                    case "control.DcnSystemApi.GetMasterMute": a[0] = mute; return API_ERROR.NONE;
                    case "control.DcnSystemApi.SetMasterMute":
                        mute = (bool)a[0];
                        RaiseLater(api, "masterMuteChange", new OnOffEventArgs { OnOff = mute });
                        return API_ERROR.NONE;

                    case "control.DiscussionApi.SpeakNow":
                    {
                        var seat = (int)a[1];
                        if (seat <= 0 || seat > 20) return API_ERROR.INVALID_PARAMETER;
                        var p = new PARTICIPANT { SeatId = seat, ParticipantId = (int)a[0], IsSpeaking = true, SpeechTimeLimitInMillis = 120000 };
                        Speakers.RemoveAll(x => x.SeatId == seat);
                        Speakers.Add(p);
                        RaiseLater(api, "MicOn", new DiscussionControlEventArgs { ParticiantInfo = new[] { p } });
                        RaiseLater(api, "SpeakersListUpdated", new DiscussionControlEventArgs { ParticiantInfo = Speakers.ToArray() });
                        return API_ERROR.NONE;
                    }
                    case "control.DiscussionApi.StopSpeaking":
                        Speakers.RemoveAll(x => x.SeatId == (int)a[1]);
                        RaiseLater(api, "SpeakersListUpdated", new DiscussionControlEventArgs { ParticiantInfo = Speakers.ToArray() });
                        return API_ERROR.NONE;
                    case "control.DiscussionApi.RetrieveSpeakersList": a[0] = Speakers.ToArray(); return API_ERROR.NONE;
                    case "control.DiscussionApi.RetrieveMicrophoneStatus":
                        a[0] = Speakers.ConvertAll(s => new SEAT_MICROPHONE_STATUS { SeatId = s.SeatId, MicStatus = MicrophoneStatus.ON }).ToArray();
                        return API_ERROR.NONE;
                    case "control.DiscussionApi.RetrieveDiscussionSettings": a[0] = discussion; return API_ERROR.NONE;
                    case "control.DiscussionApi.SetDiscussionSettings":
                        discussion = (DISCUSSION_INFO)a[0];
                        RaiseLater(api, "DiscussionSettingsUpdate", new DiscussionSettingsEventArgs { DiscussionInfo = new KeyValuePair<string, string>("NumberOfOpenMicrophones", discussion.NumberOfOpenMicrophones.ToString()) });
                        return API_ERROR.NONE;

                    case "control.MeetingApi.RetrieveActiveMeetingId": a[0] = 1; return API_ERROR.NONE;
                    case "control.MeetingApi.RetrieveActiveSessionId": a[0] = 11; return API_ERROR.NONE;
                    case "control.VoteApi.RetrieveActiveVotingId": a[0] = 0; return API_ERROR.NOT_ACTIVE;
                    case "control.VoteApi.StartAdhocVoting":
                    {
                        var s = (ADHOC_VOTING_SETTINGS)a[0];
                        if (s.AnswerSet == VotingAnswerSetType.Invalid) return API_ERROR.INVALID_PARAMETER;
                        RaiseLater(api, "VotingStart", new VoteControlEventArgs { ConfigId = 9000 });
                        return API_ERROR.NONE;
                    }
                    case "config.DelegateApi.RetrieveDelegates":
                        a[0] = new[] { 101, 102 };
                        a[1] = new[] { new DELEGATE_INFO { FirstName = "Anna", LastName = "Novak", PinCode = 1111 }, new DELEGATE_INFO { FirstName = "Ben", LastName = "Okafor" } };
                        return API_ERROR.NONE;
                    case "config.DelegateApi.RetrieveSeatAssignmentForArea":
                        if ((int)a[1] != SEAT_ASSIGNMENT.DEFAULT_AREA) return API_ERROR.INVALID_PARAMETER;
                        a[2] = new[] { new SEAT_ASSIGNMENT { SeatId = 1, SeatName = "Chairman", DelegateId = 101 } };
                        return API_ERROR.NONE;
                    case "config.MeetingApi.UpdateMeetingTitle":
                        if (a[1] == null) throw new ArgumentNullException("newMeetingTitle"); // → EXCEPTION
                        return API_ERROR.NONE;
                    default:
                        return API_ERROR.NONE;
                }
            }
        }
    }
}
