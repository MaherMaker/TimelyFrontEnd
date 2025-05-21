export interface Alarm {
  id?: number;
  userId?: number; // Keep camelCase
  deviceId?: string; // Keep camelCase
  title: string;
  time: string;
  days: number[]; // Changed from string[] to number[] to match backend expectation
  isActive?: boolean; // Keep camelCase
  sound?: string; // Changed from soundName
  volume?: number; // Added volume property
  vibration?: boolean; // Keep camelCase
  snoozeInterval?: number; // Keep camelCase
  snoozeCount?: number; // Keep camelCase
  createdAt?: string; // Change to string
  updatedAt?: string; // Change to string
  noRepeat?: boolean; // Changed from no_repeat to camelCase
  syncStatus?: 'synced' | 'pending' | 'conflict'; // Add syncStatus
  nativeAlarmId?: string; // Stores the ID returned by the native alarm plugin
}

export interface AlarmResponse {
  success: boolean;
  message?: string;
  alarm?: Alarm; // Use 'alarm' for single object
  alarms?: Alarm[]; // Use 'alarms' for array
  id?: number; // Add id for create response
  // Removed redundant 'data' property
}