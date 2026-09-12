Stripe payments/subscriptions
Free-versus-premium restrictions
Plaid production access
Password reset
Email verification
Privacy policy
Terms of service
Account deletion



Step 1: First-time user and authentication
Send screenshots from mobile and web of:

Splash/loading screen
Welcome or landing page
Signup
Login
Forgot-password screen
Password-reset confirmation
Email-verification screen, if present
First screen shown after creating a new account
Any onboarding screens

Also tell me:

Can you create a temporary test account?
Does a new account begin completely empty or receive sample data?
Can the user skip onboarding?

I’ll check branding, wording, form validation, navigation, loading/error handling, password reset, and whether a new user understands FlowSight.

Step 2: Home/Dashboard

Send mobile and web screenshots showing:

Dashboard with normal data
Entire page from top to bottom
Dashboard while loading
Dashboard with a projected shortage
Dashboard for a brand-new empty account
Every modal opened from Dashboard cards or actions

I’ll compare the UI to the calculations and inspect the underlying dashboard/forecast code.

Step 3: Plaid and account setup

Send screenshots of:

Accounts list
Add Account choices
Plaid connection introduction
Plaid success result
Plaid failure or reconnect state, if reproducible
Manual-account form
Account-details screen
Account edit screen
Account actions/menu

Do not send bank credentials, access tokens, routing numbers, or complete account numbers. Mask real balances if you prefer.

This step checks whether users can safely begin using the app and recover when a bank disconnects.

Step 4: Transactions—the most important workflow

Send mobile and web screenshots of:

Complete Transactions screen
Recent, Pending, and Expected sections
Forecast-window controls
Add Transaction form
Transaction details
Edit Transaction form
Actions/three-dot menu
Imported-match state
Transfer or credit-card-payment workflow
Filters and search
Empty and error states, if available

We’ll specifically verify:

Imported transactions are never hidden or wrongly deleted
Expected transactions resolve correctly
Manual/imported matching keeps the imported transaction
Transfers do not double-count
Running balances remain stable
Future transactions appear for the requested window
Step 5: Calendar, recurring bills, and forecasting

Send screenshots of:

Calendar month view
Day-details view
Add/edit recurring item
Recurring list
Any projected-balance detail
A 30-day forecast
A 90-day forecast
Any warning or shortage state

This is where we validate FlowSight’s core promise: “See where your money is headed.”

Step 6: Budgets, goals, and planning tools

For each feature, send its main screen plus every form/results screen:

Budget
Spending Limits
Goals
Payment Planner
What-If Plan
DTI/Mortgage calculator
Reports
Action Center

We’ll decide whether each feature is:

Ready
Needs a small fix
Should be temporarily hidden for launch

A partially working feature is more damaging than launching with a smaller, reliable feature set.

Step 7: Premium upgrade and billing

Send screenshots of:

Upgrade/paywall screen
Plan comparison
Checkout entry point
Successful subscription state
Failed/cancelled checkout state
Current-plan section
Manage/cancel subscription
What a free user sees when selecting a premium feature

I’ll verify that the UI and backend enforce the same limits. A disabled button alone is not adequate protection.

Step 8: Settings, support, privacy, and account lifecycle

Send screenshots of:

Profile/settings
Notifications
Security/password controls
Support/contact method
Privacy policy
Terms
Subscription management
Sign out
Delete account flow
Delete-account confirmation

This section can determine whether the mobile stores accept the app.

Step 9: Final device and release checks

I’ll give you a short test script to run on:

Android emulator
Physical Android device if available later
iPhone simulator or TestFlight device
Desktop browser
Narrow/mobile browser
A second browser or incognito session

We’ll test signup → connect/create account → add recurring bills → forecast → edit/delete → upgrade → sign out/in → delete account.

What to send first

Reply with the Step 0 answers, then send these first screenshots:

Mobile splash/loading
Mobile login
Mobile signup
Mobile onboarding
The first mobile screen a brand-new user sees
The equivalent web screens

Please label each screenshot with its screen name and whether it is web or mobile. Once we finish that group, I’ll tell you exactly which screenshots come next.