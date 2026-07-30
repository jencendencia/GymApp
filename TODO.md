# Completed Tasks

## 1. Kiosk Fixes
- [x] Reduce radar-container from 200px to 120px
- [x] Reduce fingerprint-icon from 48px to 32px
- [x] Reduce kiosk-title from 32px to 24px
- [x] Reduce spacing/gaps
- [x] Adjust kiosk container layout for better vertical distribution
- [x] Add member ID input styles
- [x] Add state variables (showMemberIdInput, memberIdInput, memberIdError, memberIdLoading)
- [x] Add click handler on idle area to show the hidden textfield
- [x] Add member ID input field at top of idle section
- [x] Implement handleMemberIdLogin with checkMemberIdExists API
- [x] On success → match-found/expired state, create checkin
- [x] On error → show error message
- [x] Auto-focus input when shown
- [x] Stop propagation on interactive elements to prevent conflicts

## 2. Coach Members - Unassigned & Enroll
- [x] Add "Unassigned Members" option in coach dropdown
- [x] When selected, load members with coach_id = null
- [x] Add enroll icon (👤+) in member row actions
- [x] Create Enroll to Coach modal with coach select, dates, and fee payment
- [x] Add CSS for enroll icon and modal

