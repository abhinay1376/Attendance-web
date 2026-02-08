# Firestore Security Rules for Initial Attendance

## Required Security Rules

Add these rules to your Firestore console to enforce proper security:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper function to check if user is admin
    function isAdmin() {
      return request.auth.token.email == 'YOUR_ADMIN_EMAIL@example.com';
    }
    
    // Users collection
    match /users/{userId} {
      // Students can read their own document
      allow read: if request.auth.uid == userId;
      
      // Only admin can write initialAttendance
      allow write: if isAdmin();
      
      // Students can write their own attendance records (future feature)
      allow update: if request.auth.uid == userId 
        && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['initialAttendance']);
    }
    
    // Subjects collection
    match /subjects/{subjectId} {
      allow read: if request.auth != null;
      allow write: if isAdmin();
    }
    
    // Periods collection
    match /periods/{periodId} {
      allow read: if request.auth != null;
      allow write: if isAdmin();
    }
    
    // Attendance records (future feature)
    match /attendance/{recordId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if isAdmin();
    }
  }
}
```

## Important Notes

1. Replace `YOUR_ADMIN_EMAIL@example.com` with the actual admin email from `lib/constants.ts`
2. The `initialAttendance` field can ONLY be written by admin
3. Students can read their own data but cannot modify `initialAttendance`
4. All percentage calculations are done in the client code, never stored in Firestore

## Data Structure

### User Document (`users/{uid}`)
```typescript
{
  email: string,
  initialAttendance?: {
    attended: number,  // Number of classes attended before app
    total: number      // Total classes before app
  }
}
```

### Key Points
- `attended` and `total` are stored as raw counts
- Percentage is always calculated: `(attended / total) * 100`
- Never store percentage values in Firestore
- Values represent attendance BEFORE the app started tracking
