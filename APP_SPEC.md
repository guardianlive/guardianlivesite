# How GuardianLive works

### GuardianLive is a personal safety app that combines timers, location sharing, and video streaming to keep people safe and ensure if anything bad happens to them, even if they are incapacitated, an alert is sent out and any entity selected to help them has as much data as possible to do so.

## High level on how GuardianLive works and keeps you safe:

When a user is going to do something where their safety could be jeporadized (could be as simple as walking home from work at night), they will use GuardianLive to set a timer. With this timer they can specify a name, description, response instructions, duration and which contacts to be notfied if it expires. When they start the timer, they enter the "Active" state, and this timer session starts tracking their location while counting down. If the timer reaches 0, what we refer to as "expiry", the user enters the "At Risk" state and an alert is sent out to all selected contacts, and the selected contacts can view the timers details and the at risk user's current/last known location as well as their path up until that point. Users can mark themselves as safe before or after expiry by pressing "I am safe" and entering their 4 digit PIN that they created during account setup, which ends the timer session, and then it gets put in their history with all its details. Users can also start a timer as a stream, in which case everything is the exact same but the users device starts recording and live streaming audio and video to the cloud and potential live viewers, so then when contacts view and active/at risk timer session with a stream, its just like watching alive stream and they can chat as well. When the timer session ends, the stream is stored on the cloud and can be accessed in that timer sessions history entry. Both streams and location sharing have offline archive support, so if connection is lost, it will continue storing the data on the device locally, and then when connection is established again it uploads it, therefore location path and streams will be complete in the history entry even if there is connectivity issues along the way/while live.

## Key components

### Emergency PIN/Duress state

Since this is a safety app with location sharing and streaming, for any critical action we want to lock it safely behind a 4 digit pin, so for example an assailant cant end your stream/timer. Now, given that, to accoutn for situations where a user might be under duress, we have a seprate emergency PIN that is also created during account setup. What this PIN does is immediately place the user in a "duress" state, which is viewable to the users contacts in the same timer session that the pin was entered in, and if the pin was entered when a timer was not active, it creates a new timer session just with "Unspecified" as the name and description, but the location sharing and storage will still be active. If the emergency PIN is entered, it needs to appear as if nothing is amiss, so whatever action the pin was entered for, needs to appear like it was done. The things that a pin can be entered for are: Marking yourself as safe in an active or expired timer, removing a contact, deleting a history entry, marking a contact as safe, and signing out. Signing out is the only one that will have to actually occur, but it should send out the last known location to the users contacts before signing out, but everything else should appear like it was done properly. For when a user enters the emergency pin on an active/expired timer, it will hide the timer on the users perspective and seem like it was ended properly, but will still be happening in the background. Removed contacts, confirmed safety sessions, and deleted history entries should become hidden until the user leaves the duress state. To leave the duress state, one of the users contacts has to click "Confirm safety" in the timer sessions page. If a user ever starts a timer while already in the duress state, it starts just like normal and appears as a second timer session in the contacts view. ANY time a user enters the emergency pin multiple times while already in the duress state, it just persists in the origional duress session. SO if the user in in the duress state and then starts a new timer and then uses the emergency pin in that one too, that session just ends but the origional duress session continues.

**Duress auto-resolve:** If a duress session is never confirmed safe by a contact, it automatically resolves after **1 week** from when the duress state was entered.

**Emergency PIN on sign-out:** This is the only action where the requested action actually occurs. The flow is, in this exact order: (1) all contacts on the duress session are alerted, (2) the user's location at that moment is captured and sent to the duress session, (3) the auth token is revoked and the user is properly signed out with NO background processes left running. If the user later signs back in while their previously-triggered duress state is still active (i.e. no contact has confirmed safety yet, and the 1-week auto-resolve has not elapsed), location tracking resumes automatically and they are still in the duress state.

### Other Options

Other options for timers are just more ways to customize the behavior of your timer when creating it, they are as follows:

* Don't require PIN - When this is turned on it makes it so you dont have to enter your pin to mark yourself as safe before the timer expires (while in the active state, if a timer expires you always have to use your PIN to mark yourself as safe)
* Hidden until expiry - The default is to notify your contacts and be visible when you start a timer, this option when turned on makes your timer invisble to your selected contacts both when it is live and when it becomes a history entry, UNLESS the timer expires/enters the at risk/duress state, then it will be viewable just like any other timer both live and in the history. When this transition happens (whether via natural expiry, "Alert Now", or duress — duress always wins over the hidden flag), the timer becomes visible **retroactively with all data from the start** — full location path, full stream/VOD, etc. — because once a timer is at-risk it is critical for contacts to have all of the data associated with it to get the person help.
* Disable reminders - When this is turned on all reminders that your timer is about to expire are disabled

### Notifications

Users should recieve notifications for the following things (All assume no other options are selected, of course the previously stated other options can change this, this is just the default):

* When your timer is about to expire (multiple times at various levels depending on duration) AND when your timer ACTUALLY expires
* When one of your contacts goes live, when one of your contacts timer expires, when one of your contacts enters their emergency PIN
* When someone sends you a contact request, when someone accepts your contact request.

### Apple Watch integration

GuardianLive's Apple Watch app is a companion controller for the iPhone app, not a separate source of truth. The iPhone continues to own Supabase authentication, timer writes, offline queues, streaming, and primary background location tracking.

When a user has an active, at-risk, duress, or stream timer, the watch should show the timer label, countdown or expired state, live/duress/alert badges, and the last synced phone state. The watch can trigger "Alert Now", which must use the same manual-expiry behavior as the phone and notify contacts according to the timer settings. The watch can also open or perform the safe flow. If the safe flow happens on the watch, the entered PIN must be sent to the iPhone for verification so the normal PIN and emergency PIN behavior remains identical to the phone app. An emergency PIN entered on the watch must appear successful on the watch while the iPhone triggers the duress side effects.

Location sharing remains phone-first. During normal operation, the iPhone's foreground/background location services provide the timer path. If a safety session is active and the watch loses contact with the phone, the watch may capture fallback location snapshots and queue them locally until the phone reconnects. On cellular-capable watches, the watch may upload emergency location snapshots directly only with a short-lived, timer-scoped credential. The watch must not store a long-lived Supabase session, create arbitrary timers, end sessions, change contacts, or bypass PIN/duress rules.

### More Timer Details

* Users can select any amount of their contacts to be on the notification list for that timer, so if the timer expires only the selected people are notified.
* There is an "Alert Now" button which automatically expires the timer, putting the User in the at risk state
* When a timer/stream is active, the user can press modify time, where they can just manually set how much time is left in the timer (reminder notifications need to requeue based on this new sleected time). The minimum value that can be set is **1 minute**.
* Users can edit some of the timer details while a timer is active, these are description and response instructions.
* Whenever location history in a timer session is viewed, the path is colored based on what state they were in at the time the coordinate was recorded; if they are/were in the "active" state (pre-expiry), it will be green, if they are/were in the at risk state, it will be red.
* Users can turn any timer into a stream, active or expired, by pressing the "Go Live" button. So, therefore, all basic timers can become streams, but a stream cant become a basic timer again. And for history purposes if a timer ever becomes a stream it is labeled as a stream in the users history.
* IN NO WAY should it be possible for a users to have two timer sessions going at the same time unless one is duress of course.

### History Details

Any time a User starts then stops a timer/stream, it is always stored in their history, and by default also viewable in their history by their selected contacts for that timer/stream, unless the "Hidden until expiry" other option is selected, in which case only the expired/duress history entries will be visible. The history detail page will contain all of the timer details, the location path map with the proper coloring, VOD if its a stream timer session, and the started, *expired, and ended times. If a timer is started at 7:00pm, the user presses alert now at 7:05pm, and then ends the timer session at 7:12pm, the times will show as follows: Started 7:00pm ---5m---> 7:05pm ---7m---> 7:12pm. (You can see the actual UI code for a better understaning if needed).

### Miscellaneous

* Users MUST have both PINs set and created before they can even use any part of the app, they should always be put into the PIN creation flow on startup if they arent both set. This applies to OAuth signups (e.g. Apple/Google) too — the PIN-creation flow gates app access regardless of signup method. There are no grandfathered/pre-existing users without PINs.
* Users can change their PINs any time in settings but must input their password to do so
* All emails/phone numbers can only be associated with ONE account
* Users can delete their account which deletes all associated data, in supabase and S3. If a deletion is requested while a timer/stream/duress session is active, the deletion proceeds immediately ("just nuke") — the active session is torn down and all data is removed.
* Users are able to change their name, but cant change their phone number or email.
