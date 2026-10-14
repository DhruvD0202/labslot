# A five-minute LabSlot class demo

Use the same website in two independently opened tabs: one as a student and one as faculty. Each tab keeps its own sign-in token. If a duplicated tab copied a token, log out of that tab and choose the other role. Do not open both roles in the same tab.

## Prepare once

1. Open the site a few minutes before class so a sleeping free host can wake.
2. In the student tab, choose **Student demo**, then **Enter workspace**. In the other tab, use **Faculty demo** and **Enter workspace**.
3. Both shared accounts use `LabSlot-demo-2026!`. Their emails are `student@labslot.demo` and `faculty@labslot.demo`.
4. Choose **Formlabs 3D printer**. It starts without seeded bookings. Pick an unused interval at least **three days in the future**, for example 10:00-11:00 IST. Use the same exact equipment, date and times throughout. All displayed and entered times mean campus time, Asia/Kolkata.
5. Check the relevant calendar day and use a free interval. The shared demo may contain other visitors' bookings. Prefer another empty interval rather than cancelling somebody else's session.

## 0:00-0:40 - The calendar

Show **Equipment schedule** and select the printer. Briefly point out the equipment choices and the week/day/month views.

Say: "This is a shared calendar for individual lab assets. Students can book equipment. Faculty can also schedule maintenance and request a priority override under defined rules."

## 0:40-1:25 - Make a booking

In the student tab, click **Book equipment**. Select the printer, enter your chosen future start and end, and use `Class demo: prototype printing` as the purpose. Click **Confirm booking**. Open **My bookings** and point to the `reserved` status.

Say: "This creates a confirmed reservation in PostgreSQL. The calendar shows the occupied interval."

## 1:25-2:00 - Show a conflict

Still as the student, try to book the **same printer and exact interval again**. Click **Confirm booking**. Show the conflict message. Choose **Go back** instead of joining the waitlist at this point.

Say: "The database rejects the overlapping reservation. The backend returns a conflict response, and the interface explains it. We still have only one confirmed booking."

Keep this step separate from the 20-request concurrency test. One failed UI request shows conflict handling. The automated test demonstrates competing requests.

## 2:00-3:00 - Request a faculty override

Switch to the faculty tab and choose **Book equipment**. Enter the same printer and interval. Use `Class demo: supervised research` as the purpose. Tick **Request faculty priority override**, enter `Equipment needed for scheduled faculty research`, and click **Book with priority**.

Return to the student tab and click **Refresh workspace** at the top right. Open **My bookings**, choose **All history**, and show the original booking as `displaced`. Then open **Waitlist** and show the automatically queued original interval.

Say: "The override works because this is an unused student booking at least 24 hours ahead. The trigger displaces the whole original booking, adds its interval to the waitlist, and records the change. Maintenance and faculty bookings remain protected."

## 3:00-4:00 - Cancel and promote atomically

In the faculty tab, open **My bookings** and click **Cancel** on the booking you just created. Enter `Class demo: release equipment` and confirm **Cancel reservation**.

In the student tab, click **Refresh workspace** and open **My bookings**. Show the new `reserved` booking for the original interval. The old displaced row remains under **All history**; it is not rewritten. The promoted request no longer appears as an active waiting request.

Say: "Cancelling the faculty booking releases the slot. In the same transaction, the database confirms an eligible waiting request. Either the cancellation and promotion commit together, or the row changes roll back."

The expected student promotion assumes no other eligible request ranks ahead of this request. The public demo is shared. If another eligible request wins, explain the actual priority and queue order instead of claiming a fixed person must always be promoted.

## 4:00-4:40 - Show the record

In the faculty tab, open **Activity log**. Point to the displacement, cancellation and promotion events associated with your session.

Say: "The calendar shows current occupied time. The activity log and historical reservation rows let us inspect how the booking changed."

## 4:40-5:00 - Explain the database guarantee

Show slide 4 or the exclusion constraint in the README. If asked about concurrency, show the recorded test results or run the test against the **local development database** in advance.

Say: "The exclusion constraint combines equal equipment IDs with overlapping timestamp ranges. Our recorded 20-request test produced one confirmation and nineteen conflicts. That is a tested correctness result, not a production load benchmark."

## Common questions during the demo

| Question | Answer |
| --- | --- |
| Why is the database state called `reserved`, while the presentation says confirmed? | `reserved` is the stored status that occupies time; confirmed is the user-facing description. |
| Why did the student's original row stay displaced? | History is preserved. Promotion creates a new reservation linked to the waitlist request. |
| Why did an override fail? | Check the 24-hour notice, role of every overlapping owner, recorded usage, equipment state and the required reason. Faculty and maintenance cannot be overridden. |
| Why is the calendar not updating immediately? | Use **Refresh workspace**. Visible pages also poll every 30 seconds; this MVP does not use WebSockets. |
| Can I demonstrate check-in on this future booking? | Check-in is allowed only during the booked interval. Keep the main demo focused on scheduling; use a separate current-time session if demonstrating usage. |
| How do I repeat this demonstration? | Choose a new unused future interval. Restarting does not reset bookings or erase history. |
