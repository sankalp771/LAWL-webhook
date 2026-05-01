export interface Subscriber {
  id: string;
  url: string;
  event_types: string[];
  secret: string | null;
  status: string;
  created_at: string;
}
