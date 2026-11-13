# System Models

These models follow the four perspectives from the system-modeling lecture: context, interaction, structure, and behaviour. They are intentionally lightweight and should be updated when requirements change.

## 1. Context model

The system boundary includes the web application, the SQLite database, and the optional public tunnel. External actors are the voter, candidate, administrator, and the browser.

```mermaid
flowchart LR
    Voter[Voter]
    Candidate[Candidate]
    Admin[Administrator]
    Browser[Web browser]
    App[Election Management & Voting System]
    DB[(SQLite database)]
    Tunnel[Optional Cloudflare tunnel]
    Support[IT support]

    Voter --> Browser
    Candidate --> Browser
    Admin --> Browser
    Browser --> Tunnel
    Tunnel --> App
    Browser --> App
    App --> DB
    Support --> App
    Support --> DB
```

## 2. Use-case model

```mermaid
flowchart LR
    Visitor((Visitor))
    Voter((Voter))
    Candidate((Candidate))
    Admin((Administrator))

    Browse[Browse elections and results]
    Register[Register and log in]
    Nominate[Submit or edit nomination]
    Vote[Cast a vote]
    Status[Check voting status]
    Manage[Create and manage election]
    Review[Review nominations]
    Count[Count and publish results]

    Visitor --> Browse
    Visitor --> Register
    Voter --> Register
    Voter --> Vote
    Voter --> Status
    Candidate --> Nominate
    Admin --> Manage
    Admin --> Review
    Admin --> Count
    Admin --> Browse
```

## 3. Activity model: casting a vote

```mermaid
flowchart TD
    Start([Voter opens ballot]) --> Auth{Logged in?}
    Auth -- No --> Login[Redirect to login]
    Auth -- Yes --> Eligible{Eligible?}
    Eligible -- No --> Blocked[Show not eligible]
    Eligible -- Yes --> Open{Voting open for round?}
    Open -- No --> Closed[Show not open or closed]
    Open -- Yes --> Voted{Already voted?}
    Voted -- Yes --> Duplicate[Show already voted]
    Voted -- No --> Select[Select approved candidate]
    Select --> Confirm[Review and confirm]
    Confirm --> Insert[Insert vote]
    Insert --> Unique{Unique constraint holds?}
    Unique -- No --> Duplicate
    Unique -- Yes --> Receipt[Return vote reference]
```

## 4. Class model

```mermaid
classDiagram
    class User {
        int id
        string username
        string password_hash
        string salt
        string full_name
        string email
        int email_verified
        string auth_provider
        string google_sub
        string role
        bool is_eligible
        datetime created_at
    }

    class Session {
        string id
        int user_id
        int expires_at
    }

    class Election {
        int id
        string slug
        string title
        string description
        int seats
        string method
        datetime nomination_open
        datetime nomination_close
        datetime voting_open
        datetime voting_close
        datetime round2_open
        datetime round2_close
        datetime results_at
        string stage
        string entry_mode
        int candidate_count
        string round_mode
        string eligible_group
        string voting_rules
        bool published
        datetime created_at
    }

    class Candidate {
        int id
        int election_id
        int user_id
        string name
        string initials
        string tag
        string bio
        string manifesto
        string picture
        string contacts
        string status
        bool advanced
        datetime submitted_at
        datetime updated_at
    }

    class Vote {
        int id
        int election_id
        int round
        int voter_id
        int candidate_id
        datetime created_at
    }

    class ResultEntry {
        int id
        int election_id
        int round
        int candidate_id
        int votes
        string outcome
        int eligible_voters
        datetime published_at
    }

    User "1" --> "*" Session
    User "1" --> "*" Vote
    User "1" --> "*" Candidate
    Election "1" --> "*" Candidate
    Election "1" --> "*" Vote
    Election "1" --> "*" ResultEntry
    Candidate "1" --> "*" Vote
    Candidate "1" --> "*" ResultEntry
```

## 5. Sequence model: vote submission

```mermaid
sequenceDiagram
    actor Voter
    participant SPA as Browser SPA
    participant API as Express API
    participant Auth as Auth guard
    participant DB as SQLite

    Voter->>SPA: Select candidate and confirm
    SPA->>API: POST /api/elections/:slug/votes
    API->>Auth: requireAuth
    Auth-->>API: req.user
    API->>DB: Check election, round, window, candidate
    DB-->>API: Rows
    API->>DB: Check existing vote
    DB-->>API: Existing row or none
    alt Already voted or invalid
        API-->>SPA: 409 / 403 with code
        SPA-->>Voter: Show error
    else Accepted
        API->>DB: INSERT INTO votes
        DB-->>API: Vote id
        API-->>SPA: 201 with vote reference
        SPA-->>Voter: Confirmation and receipt
    end
```

## 6. Sequence model: publish results

```mermaid
sequenceDiagram
    actor Admin
    participant SPA as Browser SPA
    participant API as Admin API
    participant Helper as Vote counter
    participant DB as SQLite

    Admin->>SPA: Open counting and publish
    SPA->>API: POST /api/admin/elections/:slug/publish
    API->>DB: Load election
    API->>Helper: countVotes(election, round)
    Helper->>DB: Aggregate approved candidates and votes
    DB-->>Helper: Candidate totals and eligible count
    Helper-->>API: Count, leader, ties
    alt Voting still open or no votes
        API-->>SPA: 409 with code
    else Publishable
        API->>DB: DELETE old result entries
        API->>DB: INSERT frozen result entries
        API->>DB: Set published = 1 and stage = Results published
        API-->>SPA: Result summary
        SPA-->>Admin: Winner or tie message
    end
```

## 7. State model: election lifecycle

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> NominationsOpen: open nominations
    NominationsOpen --> CandidateReview: close nominations
    NominationsOpen --> VotingOpen: start voting
    CandidateReview --> VotingOpen: approve candidates
    VotingOpen --> VotingClosed: close voting
    VotingClosed --> ResultsPublished: publish
    FirstRound --> SecondRound: advance finalists
    FirstRound --> VotingClosed: close first round
    SecondRound --> VotingClosed: close second round
    FirstRound --> VotingOpen
    SecondRound --> VotingOpen
    VotingClosed --> VotingOpen: reopen
    ResultsPublished --> VotingOpen: unpublish and reopen
    ResultsPublished --> VotingClosed: unpublish
    CandidateReview --> NominationsOpen
    VotingOpen --> FirstRound
    VotingOpen --> SecondRound
```

State names are displayed with spaces in the UI; this diagram uses compact names for readability.

## 8. State model: nomination review

```mermaid
stateDiagram-v2
    [*] --> Pending: submit
    Pending --> Approved: approve
    Pending --> Rejected: reject
    Pending --> Pending: return for review
    Approved --> Pending: edit before deadline
    Rejected --> [*]
    Approved --> [*]
```

## 9. Model-to-code mapping

| Model | Code artifact |
|---|---|
| Context | `server/app.js`, `start-public.ps1` |
| Use cases | `app.js` route handlers and `server/routes/*.js` |
| Class model | `server/db.js` schema |
| Vote sequence | `server/routes/votes.js` |
| Publish sequence | `server/routes/admin.js`, `server/helpers.js` |
| Election state | `server/helpers.js` `electionStatus()`, `server/routes/admin.js` transitions |
| Nomination state | `server/routes/nominations.js`, `server/routes/admin.js` |
