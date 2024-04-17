export function processPath(records: any) {
    let path
    const route: { name: string, location: { latitude: string, longitude: string }}[] = []

    // processes intermediary and destination nodes
    for (let record of records) {
      path = record.get('p').segments
      const start_location = path[0].start

      route.push(
        {
          name: start_location.properties.name,
          location: {
            latitude: start_location.properties.latitude,
            longitude: start_location.properties.longitude
          }
        }
      )

      for (let segment of path) {
        let node = segment.end

        route.push(
          {
            name: node.properties.name,
            location: {
              latitude: node.properties.latitude,
              longitude: node.properties.longitude
            }
          }
        )
      }
    }
    
    return route
}

export function processSearch(records: any) {
    let location
    const matches: { name: string, location: { latitude: string, longitude: string }}[] = []

    for (let record of records) {
      location = record.get('n')
      matches.push(
        {
          name: location.properties["name"],
          location: {
            latitude: location.properties["latitude"],
            longitude: location.properties["longitude"]
          }
        }
      )
    }

    return matches
}