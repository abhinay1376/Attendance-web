# 2.5D Visual Depth Enhancements

## Overview
Added subtle 3D-like visual depth to the UI using CSS-only techniques (no 3D rendering libraries). The enhancements create a premium, modern feel with layered shadows, elevation, and perspective effects.

## CSS Depth System

### Elevation Classes (`globals.css`)
Four levels of elevation with layered shadows:

- **elevation-1**: Subtle lift (1-2px)
- **elevation-2**: Medium lift (2-4px) - Default for cards
- **elevation-3**: Noticeable lift (4-10px) - Key UI elements
- **elevation-4**: Prominent lift (10-20px) - Important actions/warnings

Each elevation level automatically adjusts for dark mode with enhanced shadow opacity.

### Visual Effects

1. **Depth Hover**: Subtle lift and scale on hover
   - translateY(-2px) + scale(1.01)
   - Applied to interactive cards

2. **Inner Shadow**: Recessed appearance for inputs
   - Creates depth perception for form fields
   - Adapts to dark mode

3. **Perspective Container**: 3D context for child elements
   - perspective: 1000px
   - Used for card grids

4. **Preserve 3D**: Maintains 3D transform space
   - Applied to layered cards
   - Enables nested 3D transforms

5. **Backface Hidden**: Prevents rendering artifacts
   - Optimizes 3D transforms
   - Smooths animations

6. **Layered Background**: Subtle radial gradients
   - Creates ambient depth perception
   - Different for light/dark modes

## Component Updates

### Card Component
- Added `elevation` prop (1-4)
- Default elevation: 2
- Auto-applies depth-hover for levels 2-4
- Preserves 3D transform space

### Button Component
- Built-in elevation-2 shadow
- Active state reduces to elevation-1 (pressed effect)
- Spring animation for tactile feedback (scale: 0.97)

### Input Component
- Inner shadow for recessed appearance
- Focus state elevates with elevation-1
- Creates "rising" effect on interaction

## Page-Level Enhancements

### Student Page
- Perspective container for main content
- Summary cards: elevation-3
- Date selection card: elevation-3
- Period cards: elevation-3 with perspective
- Layered background gradient

### Admin Page
- Perspective container for main content
- All management cards: elevation-3
- Danger zone card: elevation-4 (visual hierarchy)
- Layered background gradient

### Login/Register Pages
- Auth cards: elevation-4 (focal point)
- Centered with layered background
- Creates "floating" appearance

## Animation Integration

The depth system works seamlessly with existing framer-motion animations:

1. **Card Entrance**: Fade + slide pairs with elevation reveal
2. **Hover Effects**: depth-hover enhances interactive feedback
3. **Button Press**: Scale animation + elevation change = realistic depth
4. **Page Transitions**: Elevation maintains during slide/fade

## Performance Optimizations

- All effects use GPU-accelerated properties (transform, opacity)
- Box-shadow uses multiple layers (not blur-intensive)
- Perspective applied only to containers (not individual elements)
- Backface-visibility prevents unnecessary repaints
- Transitions limited to 200ms for responsiveness

## Dark Mode Support

Every depth effect includes dark mode variants:
- Increased shadow opacity for visibility
- Adjusted background gradients
- Inner shadows darkened
- Elevation shadows enhanced

## Accessibility

- Depth effects don't interfere with focus states
- All interactive elements maintain proper focus rings
- Elevation creates visual hierarchy without relying solely on color
- Hover effects provide additional feedback beyond depth

## Browser Compatibility

- All CSS features have wide support (transform, box-shadow, perspective)
- No vendor prefixes needed for modern browsers
- Graceful degradation: depth effects are visual enhancements only
- Backdrop-filter includes -webkit- prefix for Safari

## Usage Examples

### Card with Elevation
```tsx
<Card elevation={3}>
  <CardHeader>...</CardHeader>
</Card>
```

### Perspective Grid
```tsx
<div className="perspective-container">
  <div className="grid gap-4">
    <Card elevation={2} className="depth-hover">...</Card>
  </div>
</div>
```

### Layered Background
```tsx
<div className="page-background min-h-screen">
  {/* content */}
</div>
```

## Result

The UI now has:
- ✅ Layered cards with multi-level shadows
- ✅ Elevation hierarchy (1-4 levels)
- ✅ CSS perspective effects (1000px)
- ✅ Subtle parallax/scale on hover
- ✅ Recessed inputs with inner shadows
- ✅ Pressed button depth effect
- ✅ Ambient background gradients
- ✅ Full dark mode support
- ✅ Zero 3D rendering libraries
- ✅ GPU-accelerated performance
