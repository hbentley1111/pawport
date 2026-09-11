# Global owner navigation

The shared `AppFrame` provides a sticky Pawport header on desktop and a fixed bottom navigation below 768px. Both use `AppNavigationLinks`, with current-route selection from `usePathname`. Destinations are Home `/`, Pets `/`, Records `/records`, Services `/services`, and Account `/account`. Home is active at `/`; Pets is active on profile/add/edit routes; Records is active on both `/records` and per-pet record pages. The logo links home. Vaccinations and sharing remain in the existing pet navigation.

Household home keeps its existing hero/cards and adds four compact quick-access cards: Health Records, Local Services, Add Pet, and Account. The records picker deliberately does not show those extra cards. Existing one-pet and multi-pet routing is unchanged, including the one-pet records redirect. Add Pet still uses the existing 20-pet enforcement.

Known owner pages use `AppFrame` after their existing ownership checks. Account and Services use `OwnerAppFrame`, which verifies the session and household before showing owner navigation. Provider-only and signed-out visitors do not receive owner navigation. The provider workspace, auth pages and onboarding retain their separate presentation/routing. The sample dashboard keeps its existing preview shell.

Navigation has semantic landmarks, text labels, decorative icons, `aria-current`, visible focus rings and 54px mobile targets. The fixed bottom bar reserves content space plus iPhone safe-area inset. Viewport-fit enables those insets; page scrolling accounts for both bars. Desktop navigation is hidden on mobile, and mobile navigation is hidden on desktop/tablet. No database, RLS, Google integration, review, password or verification logic changed.

Verification: navigation/quick-access render tests and active-route tests; guards for auth/provider exclusion and existing routing. Browser fixture checks at 390×844, 820×1180 and 1440×1000 cover household cards, single-pet hierarchy, long-form bottom clearance, no overflow, active Records selection and keyboard focus. Fixtures contain local sample data and are removed before build. Real provider/owner login workflows require staging accounts; no account or medical data is modified by these checks.

Phase 5A adds **Care → /appointments** on desktop. Mobile replaces Records with Care to keep five targets; Health Records remains a direct link on the Care page and household Quick access. See [Care Calendar](CARE_CALENDAR.md) for the updated behavior.
