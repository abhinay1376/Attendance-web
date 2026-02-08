# Firestore Security Rules Deployment

## Deploy Rules to Firebase

To deploy the Firestore security rules to your Firebase project:

```bash
# Install Firebase CLI if not already installed
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase in your project (if not done)
firebase init firestore

# Deploy the rules
firebase deploy --only firestore:rules
```

## Critical Security Rules

The `firestore.rules` file enforces:

1. **Approval Gate**: Students CANNOT write attendance unless `approved == true`
2. **Admin Control**: Only admin can approve/reject users
3. **Read Isolation**: Users can only read their own data
4. **Holiday Management**: Only admin can create/delete holidays
5. **Audit Trail**: Only admin can access audit logs

## Verify Rules

After deployment:
1. Go to Firebase Console > Firestore Database > Rules
2. Verify the rules are published
3. Check the "Simulator" tab to test scenarios

## Test Cases

**Unapproved student tries to write attendance:**
- Request: `set /attendance/USER_ID/dates/2026-02-08`
- Result: ❌ Permission Denied

**Approved student writes attendance:**
- Request: `set /attendance/USER_ID/dates/2026-02-08`
- Check: `users/USER_ID.approved == true`
- Result: ✅ Allowed

**Admin approves student:**
- Request: `update /users/USER_ID {approved: true}`
- Result: ✅ Allowed
