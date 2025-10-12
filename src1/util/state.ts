export interface State {
  message?: string;
  memory?: string;
  history?: any[];
  category?: string;
  final_answer?: string;
  [key: string]: any;
}
