import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin, PluginListenerHandle, CapacitorException } from '@capacitor/core';

// --- START: Plugin Specific Interfaces based on README ---
export interface AlarmConfig {
  alarmId: string;       // Unique ID for the alarm (string)
  at: number;            // Timestamp in milliseconds for when the alarm should fire
  name?: string;          // Internal name for the alarm (optional)
  exact?: boolean;        // Whether the alarm should be exact (default: true, if supported)
  extra?: { [key: string]: any }; // Custom data to be delivered with the alarm
  uiOptions?: {          // Options for the alarm ringing UI
    titleText?: string;    // Main title on the ringing screen
    alarmNameText?: string; // Sub-text or alarm name on the ringing screen
    // ... other uiOptions from plugin's definitions.ts if available (e.g., backgroundColor, dismissButtonText)
  };
  // Note: 'repeat' and 'days' are not directly in the README's AlarmConfig example.
  // These would need to be handled by how 'at' is calculated or if 'extra' is used by the native part for repeating logic.
}

export interface CancelOptions {
  alarmId: string;
}

export interface IsScheduledOptions {
  alarmId: string;
}

export interface IsScheduledResult {
  isScheduled: boolean;
}

export type PermissionName = 'POST_NOTIFICATIONS' | 'SCHEDULE_EXACT_ALARM' | 'SYSTEM_ALERT_WINDOW'; // From README

export interface PermissionStatusResult {
  status: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'; // Common statuses
}

export interface AlarmEventData {
  alarmId: string;       // This is the NATIVE alarmId (e.g., "timely-16")
  name?: string;
  extra?: { [key: string]: any; backendAlarmId?: number }; // Added extra field to carry backendAlarmId
}
// --- END: Plugin Specific Interfaces ---

// Define the interface for the plugin based on its methods from README
export interface MaherMakerAlarmManagerPlugin {
  set(options: AlarmConfig): Promise<{ alarmId: string }>;
  cancel(options: CancelOptions): Promise<void>;
  isScheduled(options: IsScheduledOptions): Promise<IsScheduledResult>;
  checkPermissions(options: { permission: PermissionName }): Promise<PermissionStatusResult>;
  requestPermissions(options: { permission: PermissionName }): Promise<PermissionStatusResult>;
  addListener(eventName: string, listenerFunc: (eventData: AlarmEventData) => void): Promise<PluginListenerHandle> & PluginListenerHandle;
  // getAllAlarms(): Promise<any[]>; // This was in our old interface, README doesn't explicitly list it, verify if needed
}

const AlarmManager = registerPlugin<MaherMakerAlarmManagerPlugin>('AlarmManager');

@Injectable({
  providedIn: 'root'
})
export class AlarmManagerService {

  constructor() {
    console.log('AlarmManagerService: Constructor called');
    if (!AlarmManager) {
      console.warn('AlarmManagerService: Native plugin \'AlarmManager\' not available. Ensure it is installed and registered correctly.');
    } else {
      console.log('AlarmManagerService: Native plugin \'AlarmManager\' is available.');
    }
  }

  async checkAndRequestPermissions(): Promise<void> {
    console.log('AlarmManagerService: checkAndRequestPermissions called (using plugin methods).');
    try {
      // Check/Request POST_NOTIFICATIONS (Android 13+)
      let notifResult = await AlarmManager.checkPermissions({ permission: 'POST_NOTIFICATIONS' });
      console.log('AlarmManagerService: POST_NOTIFICATIONS permission status:', notifResult.status);
      if (notifResult.status !== 'granted') {
        notifResult = await AlarmManager.requestPermissions({ permission: 'POST_NOTIFICATIONS' });
        console.log('AlarmManagerService: POST_NOTIFICATIONS permission status after request:', notifResult.status);
        if (notifResult.status !== 'granted') {
          console.warn('AlarmManagerService: POST_NOTIFICATIONS permission was not granted.');
        }
      }

      // Check/Request SCHEDULE_EXACT_ALARM (Android 12+)
      // The plugin's requestPermissions for SCHEDULE_EXACT_ALARM might take the user to settings.
      let exactAlarmResult = await AlarmManager.checkPermissions({ permission: 'SCHEDULE_EXACT_ALARM' });
      console.log('AlarmManagerService: SCHEDULE_EXACT_ALARM permission status:', exactAlarmResult.status);
      if (exactAlarmResult.status !== 'granted') {
        exactAlarmResult = await AlarmManager.requestPermissions({ permission: 'SCHEDULE_EXACT_ALARM' });
        console.log('AlarmManagerService: SCHEDULE_EXACT_ALARM permission status after request (user might have been taken to settings):', exactAlarmResult.status);
        if (exactAlarmResult.status !== 'granted') {
          console.warn('AlarmManagerService: SCHEDULE_EXACT_ALARM permission was not granted. User may need to grant it manually in app settings.');
        }
      }

      // Check/Request SYSTEM_ALERT_WINDOW
      let overlayResult = await AlarmManager.checkPermissions({ permission: 'SYSTEM_ALERT_WINDOW' });
      console.log('AlarmManagerService: SYSTEM_ALERT_WINDOW permission status:', overlayResult.status);
      if (overlayResult.status !== 'granted') {
        // Requesting SYSTEM_ALERT_WINDOW usually opens a system settings page.
        // The result of requestPermissions for this might just indicate the prompt was shown.
        // The user has to manually grant it there.
        await AlarmManager.requestPermissions({ permission: 'SYSTEM_ALERT_WINDOW' });
        // Re-check after attempting to request, though direct status might not change immediately
        // as user interacts with system settings.
        overlayResult = await AlarmManager.checkPermissions({ permission: 'SYSTEM_ALERT_WINDOW' });
        console.log('AlarmManagerService: SYSTEM_ALERT_WINDOW permission status after request attempt:', overlayResult.status);
        if (overlayResult.status !== 'granted') {
          console.warn('AlarmManagerService: SYSTEM_ALERT_WINDOW permission was not granted. User may need to grant it manually via app settings for optimal alarm display.');
        }
      }

    } catch (error) {
      console.error('AlarmManagerService: Error during plugin permission check/request:', error);
      if (error instanceof CapacitorException) {
        console.error('AlarmManagerService: CapacitorException code:', error.code, 'message:', error.message);
      }
    }
  }

  async setNativeAlarm(options: AlarmConfig): Promise<{ alarmId: string }> { // Changed options type and return type
    console.log('AlarmManagerService: setNativeAlarm (now calling .set) called with options:', JSON.stringify(options));
    if (!AlarmManager) {
      console.error('AlarmManagerService: Plugin not available for setNativeAlarm');
      return Promise.reject('Plugin not available');
    }
    try {
      // Using .set as per README
      const result = await AlarmManager.set(options);
      console.log('AlarmManagerService: .set result:', result);
      return result;
    } catch (error) {
      console.error('AlarmManagerService: Error in .set:', error);
      if (error instanceof CapacitorException) {
        console.error('AlarmManagerService: CapacitorException code:', error.code, 'message:', error.message);
      }
      throw error;
    }
  }

  async cancelNativeAlarm(options: CancelOptions): Promise<void> { // Changed options type
    console.log('AlarmManagerService: cancelNativeAlarm called with options:', JSON.stringify(options));
    if (!AlarmManager) {
      console.error('AlarmManagerService: Plugin not available for cancelNativeAlarm');
      return Promise.reject('Plugin not available');
    }
    try {
      const result = await AlarmManager.cancel(options);
      console.log('AlarmManagerService: cancelNativeAlarm result:', result);
      return result;
    } catch (error) {
      console.error('AlarmManagerService: Error in cancelNativeAlarm:', error);
      if (error instanceof CapacitorException) {
        console.error('AlarmManagerService: CapacitorException code:', error.code, 'message:', error.message);
      }
      throw error;
    }
  }

  async checkNativeAlarm(options: IsScheduledOptions): Promise<IsScheduledResult> { // Changed options and return type
    console.log('AlarmManagerService: checkNativeAlarm called with options:', JSON.stringify(options));
    if (!AlarmManager) {
      console.error('AlarmManagerService: Plugin not available for checkNativeAlarm');
      return Promise.reject('Plugin not available');
    }
    try {
      const result = await AlarmManager.isScheduled(options);
      console.log('AlarmManagerService: checkNativeAlarm (isScheduled) result:', result);
      return result;
    } catch (error) {
      console.error('AlarmManagerService: Error in checkNativeAlarm (isScheduled):', error);
      if (error instanceof CapacitorException) {
        console.error('AlarmManagerService: CapacitorException code:', error.code, 'message:', error.message);
      }
      throw error;
    }
  }

  // getAllNativeAlarms(): Promise<any[]> - This method is not in the README's API example.
  // If your plugin *does* support it, you'd add it to MaherMakerAlarmManagerPlugin and implement it here.
  // For now, it's commented out.
  /*
  async getAllNativeAlarms(): Promise<any[]> {
    console.log('AlarmManagerService: getAllNativeAlarms called');
    if (!AlarmManager || !AlarmManager.getAllAlarms) { // Check if method exists
      console.error('AlarmManagerService: Plugin not available or getAllAlarms not implemented on plugin.');
      return Promise.reject('Plugin not available or method not implemented');
    }
    try {
      const result = await AlarmManager.getAllAlarms();
      console.log('AlarmManagerService: getAllNativeAlarms result:', result);
      return result;
    } catch (error) {
      console.error('AlarmManagerService: Error in getAllNativeAlarms:', error);
      if (error instanceof CapacitorException) {
        console.error('AlarmManagerService: CapacitorException code:', error.code, 'message:', error.message);
      }
      throw error;
    }
  }
  */

  async listenToAlarmTriggers(eventName: string, callback: (info: AlarmEventData) => void): Promise<PluginListenerHandle> {
    console.log('AlarmManagerService: listenToAlarmTriggers called for event:', eventName);
    if (!AlarmManager) {
      console.error('AlarmManagerService: Plugin not available for listenToAlarmTriggers');
      return Promise.reject('Plugin not available');
    }
    try {
      const listenerHandle = await AlarmManager.addListener(eventName, callback);
      console.log('AlarmManagerService: listenToAlarmTriggers listener added for event:', eventName);
      return listenerHandle;
    } catch (error) {
      console.error('AlarmManagerService: Error in listenToAlarmTriggers for event '+eventName+':', error);
      if (error instanceof CapacitorException) {
        console.error('AlarmManagerService: CapacitorException code:', error.code, 'message:', error.message);
      }
      throw error;
    }
  }

  // removeAlarmTriggerListener is implicitly handled by PluginListenerHandle.remove()
  // No direct wrapper needed unless adding more logic.
}
