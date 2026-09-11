# runLeadDrone creates duplicate leads on re-run

**Found:** 2026-09-12, merging in-flight work.

## What

`packages/core/marketing/lead-drones.js` calls `createLead()` unconditionally for
every qualifying signal. Flying the same drone twice over a feed that still
carries the same items inserts the same lead again. There is no natural key and
no `listLeads` check before insert.

The sibling path solved this: `packages/core/targets/lead-persistence.js` reads
existing leads for the campaign, keys them by `rawRecord.repo`, and updates
rather than duplicating. Both write to the same `leads` table.

## Why it was not done now

The two paths take different inputs — drones read signal feeds, the sweep reads
code scans — so the natural key differs and is not obvious for the generic drone
case. Picking one unilaterally inside someone else's module during a merge would
be guessing at their design.

## Why it matters

Leads are the thing being counted on the way to a first customer. A duplicated
lead inflates the count and wastes an outreach slot on someone already contacted.

## Done looks like

A natural key for drone-sourced leads — a signal id or a URL — checked before
insert, or a unique index on `(campaign_key, rawRecord->>'<key>')` and an
`ON CONFLICT` clause. Then delete this file in the same commit.
