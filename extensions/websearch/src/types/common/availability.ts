export type AvailabilityStatus = 'available' | 'deleted' | 'removed' | 'private' | 'unavailable';

export type Availability = {
  status: AvailabilityStatus;
  reason?: string;
};
