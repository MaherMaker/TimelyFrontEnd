# Timely Mobile App

## Technical Overview

Timely is an advanced alarm management application built with Ionic Angular and Capacitor. This application provides cross-device alarm synchronization through Firebase Cloud Messaging and real-time updates via Socket.io.

## Development Environment Setup

### Required Tools & Dependencies

- Node.js v18+ and npm v8+
- Ionic CLI: `npm install -g @ionic/cli`
- Angular CLI: `npm install -g @angular/cli`
- Android Studio (for Android development)
- Xcode (for iOS development, macOS only)

### Installation Steps

1. **Install dependencies**:

```bash
npm install
```

2. **Start the development server**:

```bash
ionic serve
```

3. **Run with live reload on Android**:

```bash
# Build the app
ionic capacitor build android

# Live reload
ionic capacitor run android -l --external
```

## Key Features Technical Implementation

### Firebase Push Notifications

The app uses Firebase Cloud Messaging for reliable background synchronization:

1. **Configuration**:

   - Firebase initialization happens in `app.module.ts`
   - Push notification handlers are in `app.component.ts`

2. **Token Management**:

   - FCM token retrieval: `PushNotifications.register()`
   - Token storage and server registration: `DeviceService.registerDevice()`

3. **Handling Notifications**:
   - Data-only messages trigger background sync
   - User-visible notifications are handled by the system when app is closed

### Alarm Synchronization

Alarms are synchronized across devices using both push notifications and WebSockets:

1. **Real-time Updates** (Socket.io):

   - Connection management handled in `SocketService`
   - Event listeners for alarm-related events

2. **Background Sync** (FCM):
   - Data messages trigger `AlarmService.syncAlarms()`
   - Periodic sync on app foreground events

### Authentication

Authentication is handled by `AuthService` with the following features:

1. **Token Management**:

   - JWT storage using `StorageService`
   - Automatic token refresh
   - Logout across devices

2. **Security**:
   - HTTP interceptors for authentication headers
   - Secure storage for sensitive data

## Native Integrations

This app uses multiple Capacitor plugins for native functionality:

1. **Push Notifications**: `@capacitor/push-notifications`

   - Handles registration and delivery of FCM messages

2. **Local Notifications**: `@capacitor/local-notifications`

   - Used for alarm triggering when app is in foreground

3. **App Lifecycle**: `@capacitor/app`

   - Manages application state transitions
   - Triggers sync operations on resume

4. **Android Alarm Manager**: `@mahermaker/android-alarm-manager`
   - Custom plugin for reliable alarm scheduling on Android

## Building and Deployment

### Android Build

```bash
# Generate production build
ionic capacitor build android --prod

# Open in Android Studio
npx cap open android
```

### iOS Build (macOS only)

```bash
# Generate production build
ionic capacitor build ios --prod

# Open in Xcode
npx cap open ios
```

## Testing

The application has comprehensive test coverage:

1. **Unit Tests**:

```bash
ng test
```

2. **End-to-End Tests**:

```bash
ng e2e
```

## Performance Optimization

The app implements several performance optimization strategies:

1. **Lazy Loading**:

   - Feature modules are lazy-loaded for faster startup

2. **Memory Management**:

   - Subscription cleanup in component destruction
   - Efficient data structures for alarm storage

3. **Battery Optimization**:
   - Intelligent sync scheduling
   - Minimal background processing

## Known Issues & Solutions

1. **FCM Token Refresh**:

   - Monitor `pushNotificationRegistrationError` events
   - Implement retry logic in `deviceService.ts`

2. **Socket Reconnection**:

   - Socket.io configured with reconnection attempts
   - Manual reconnection on network change events

3. **UI Performance**:
   - Use trackBy functions in ngFor loops
   - Implement virtual scrolling for long alarm lists

## Contributing

1. Follow the Angular style guide
2. Maintain test coverage above 80%
3. Use the provided ESLint and Prettier configurations
