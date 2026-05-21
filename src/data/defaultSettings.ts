// Default parameter settings backup (from Firebase/Firestore)
// This serves as backup in case Firebase data is lost

export interface DefaultParameterSettings {
  show_in_legend: boolean;
  visible_on_chart: boolean;
  favorite: number;
  position: number;
  color: string;
}

// Base parameters default visual settings
export const defaultBaseParameterSettings: Record<string, DefaultParameterSettings> = {
  T: {
    show_in_legend: true,
    visible_on_chart: true,
    favorite: 1,
    position: 0,
    color: "#d62728"
  },
  PL: {
    show_in_legend: true,
    visible_on_chart: true,
    favorite: 1,
    position: 1,
    color: "#1f77b4"
  },
  SL: {
    show_in_legend: true,
    visible_on_chart: true,
    favorite: 1,
    position: 2,
    color: "#2ca02c"
  },
  P: {
    show_in_legend: true,
    visible_on_chart: true,
    favorite: 1,
    position: 3,
    color: "#ff7f0e"
  },
  N: {
    show_in_legend: true,
    visible_on_chart: true,
    favorite: 1,
    position: 4,
    color: "#9467bd"
  }
};

// Default colors for new parameters (cycling palette)
export const defaultParameterColors = [
  '#d62728', '#2ca02c', '#1f77b4', '#ff7f0e', '#9467bd', 
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
  '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5', 
  '#c49c94', '#f7b6d2', '#c7c7c7', '#dbdb8d', '#9edae5'
];

// Default user preferences
export const defaultUserPreferences = {
  show_in_legend: false,
  visible_on_chart: false,
  favorite: 0,
  position: Infinity
}; 