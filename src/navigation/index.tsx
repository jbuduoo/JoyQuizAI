import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import QuizScreen from '../screens/QuizScreen';
import SettingsScreen from '../screens/SettingsScreen';
import DownloadScreen from '../screens/DownloadScreen';
import ManageDataScreen from '../screens/ManageDataScreen';
import { Question, ViewMode } from '../types';

export type RootStackParamList = {
  Home: undefined;
  Settings: undefined;
  Download: undefined;
  DataManagement: undefined;
  Quiz: { 
    questions: Question[]; 
    title: string;
    startIndex?: number;
    viewMode?: ViewMode;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Navigation() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen 
          name="Home" 
          component={HomeScreen} 
          options={{ headerShown: false }}
        />
        <Stack.Screen 
          name="Quiz" 
          component={QuizScreen} 
          options={{ headerShown: false }}
        />
        <Stack.Screen 
          name="Settings" 
          component={SettingsScreen} 
          options={{ headerShown: false }}
        />
        <Stack.Screen 
          name="Download" 
          component={DownloadScreen} 
          options={{ headerShown: false }}
        />
        <Stack.Screen 
          name="DataManagement" 
          component={ManageDataScreen} 
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
