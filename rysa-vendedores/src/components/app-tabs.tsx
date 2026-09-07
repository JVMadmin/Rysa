import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AppTabs() {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 12);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#D32F2F',
        tabBarInactiveTintColor: '#718096',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#E2E8F0',
          height: 56 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="dashboard" size={size || 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="clientes/index"
        options={{
          title: 'Cartera',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="people-alt" size={size || 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="pedidos/index"
        options={{
          title: 'Vender',
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '800',
            color: '#D32F2F',
            marginTop: 2,
          },
          tabBarIcon: ({ focused }) => (
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                backgroundColor: focused ? '#B71C1C' : '#D32F2F',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: -12,
                shadowColor: '#D32F2F',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.35,
                shadowRadius: 5,
                elevation: 5,
              }}
            >
              <MaterialIcons name="add-shopping-cart" size={28} color="#FFFFFF" />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="catalogo/index"
        options={{
          title: 'Catálogo',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="menu-book" size={size || 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="visitas/index"
        options={{
          title: 'Ruta GPS',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="near-me" size={size || 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cobranza/index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
