'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Location } from '@/lib/types'

// Fix for default marker icons in Leaflet with Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

interface BranchMapProps {
  locations: Location[]
  selectedLocationId?: number
  onLocationSelect: (locationId: number) => void
  userLocation?: { lat: number; lng: number } | null
}

export default function BranchMap({ locations, selectedLocationId, onLocationSelect, userLocation }: BranchMapProps) {
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<L.Marker[]>([])
  const userMarkerRef = useRef<L.Marker | null>(null)
  const circleRef = useRef<L.Circle | null>(null)

  useEffect(() => {
    if (!mapRef.current && locations.length > 0) {
      // Calculate center - prioritize user location if available
      let centerLat, centerLng, zoom

      if (userLocation) {
        centerLat = userLocation.lat
        centerLng = userLocation.lng
        zoom = 13
      } else {
        centerLat = locations.reduce((sum, loc) => sum + loc.latitude, 0) / locations.length
        centerLng = locations.reduce((sum, loc) => sum + loc.longitude, 0) / locations.length
        zoom = 12
      }

      // Initialize map
      const map = L.map('branch-map').setView([centerLat, centerLng], zoom)
      mapRef.current = map

      // Add tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map)

      // Add markers for each location
      locations.forEach((location) => {
        const marker = L.marker([location.latitude, location.longitude])
          .addTo(map)
          .bindTooltip(location.name, {
            permanent: false,
            direction: 'top',
            className: 'branch-tooltip',
            offset: [0, -30],
          })

        marker.on('click', () => {
          onLocationSelect(location.id)
        })

        markersRef.current.push(marker)
      })

      // Make select function globally available for popup buttons
      ;(window as any).selectLocation = (id: number) => {
        onLocationSelect(id)
      }

      // Add user location marker if available
      if (userLocation) {
        // Create custom prominent icon for user location
        const userIcon = L.divIcon({
          className: 'user-location-marker',
          html: `
            <div style="position: relative; z-index: 1000;">
              <div style="position: absolute; top: 50%; left: 50%; width: 60px; height: 60px; background: rgba(16, 185, 129, 0.3); border-radius: 50%; transform: translate(-50%, -50%); animation: pulse 2s infinite;"></div>
              <div style="position: absolute; top: 50%; left: 50%; width: 40px; height: 40px; background: rgba(16, 185, 129, 0.5); border-radius: 50%; transform: translate(-50%, -50%);"></div>
              <div style="position: absolute; top: 50%; left: 50%; width: 24px; height: 24px; background: #10b981; border: 4px solid white; border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 15px rgba(16, 185, 129, 0.8), 0 0 30px rgba(16, 185, 129, 0.4);"></div>
            </div>
          `,
          iconSize: [60, 60],
          iconAnchor: [30, 30],
        })

        const userMarker = L.marker([userLocation.lat, userLocation.lng], {
          icon: userIcon,
          zIndexOffset: 1000 // Keep user marker on top
        })
          .addTo(map)

        userMarkerRef.current = userMarker

        // Add more visible circle to show proximity
        const circle = L.circle([userLocation.lat, userLocation.lng], {
          radius: 2000, // 2km radius
          color: '#10b981',
          fillColor: '#10b981',
          fillOpacity: 0.08,
          weight: 3,
          dashArray: '10, 10',
        }).addTo(map)

        circleRef.current = circle
      }
    }

    // Cleanup function
    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        markersRef.current = []
        userMarkerRef.current = null
        circleRef.current = null
      }
    }
  }, [locations, onLocationSelect, userLocation])

  // Update marker styles when selection changes
  useEffect(() => {
    if (!mapRef.current) return

    locations.forEach((location, index) => {
      const marker = markersRef.current[index]
      if (!marker) return

      if (location.id === selectedLocationId) {
        // Highlight selected marker
        const icon = L.icon({
          iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
          iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
          iconSize: [38, 60],
          iconAnchor: [19, 60],
          popupAnchor: [0, -60],
          shadowSize: [60, 60],
        })
        marker.setIcon(icon)
        marker.openPopup()

        // Pan to selected location
        mapRef.current?.setView([location.latitude, location.longitude], 15, {
          animate: true,
          duration: 0.5,
        })
      } else {
        // Reset to default marker
        const icon = L.icon({
          iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
          iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41],
        })
        marker.setIcon(icon)
      }
    })
  }, [selectedLocationId, locations])

  return (
    <div className="relative">
      <div
        id="branch-map"
        className="w-full h-[400px] rounded-xl border-2 border-gray-200 shadow-md z-0"
        style={{ zIndex: 0 }}
      />
      <style jsx global>{`
        @keyframes pulse {
          0% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(1.5);
          }
        }

        .branch-tooltip {
          background: rgba(0, 0, 0, 0.8) !important;
          border: none !important;
          border-radius: 8px !important;
          padding: 8px 12px !important;
          font-weight: 600 !important;
          font-size: 13px !important;
          color: white !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
        }

        .branch-tooltip::before {
          border-top-color: rgba(0, 0, 0, 0.8) !important;
        }
      `}</style>
    </div>
  )
}
