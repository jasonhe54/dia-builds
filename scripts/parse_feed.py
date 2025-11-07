#!/usr/bin/env python3

import sys
import json
# Explicitly import lxml.etree
from lxml import etree as ET

def parse_sparkle_feed(xml_file):
    """
    Parses a Sparkle XML feed using lxml's recovery mode
    to handle malformed XML (like invalid xmlns attributes).
    """
    
    # Define the namespaces. 'rss' is our alias for the weird "xmlns"
    # default namespace, and 'sparkle' is for Sparkle.
    namespaces = {
        'rss': 'xmlns',
        'sparkle': 'http://www.andymatuschak.org/xml-namespaces/sparkle'
    }

    try:
        # THIS IS THE KEY CHANGE:
        # Create a parser that will attempt to recover from errors.
        parser = ET.XMLParser(recover=True)
        
        # Parse the file using the recovery-mode parser.
        # We read the file as bytes, as lxml prefers this.
        with open(xml_file, 'rb') as f:
            tree = ET.parse(f, parser=parser)
        
        root = tree.getroot()
        items = []
        
        # Find all <item> tags (in the 'rss' namespace)
        for item in root.findall('.//rss:item', namespaces):
            
            version_elem = item.find('sparkle:version', namespaces)
            version = version_elem.text if version_elem is not None else ''

            short_version_elem = item.find('sparkle:shortVersionString', namespaces)
            short_version = short_version_elem.text if short_version_elem is not None else ''

            desc_elem = item.find('rss:description', namespaces)
            description = desc_elem.text if desc_elem is not None else ''

            # Find the main enclosure
            zip_url = ''
            delta_attr_key = f"{{{namespaces['sparkle']}}}deltaFrom"
            
            # Find enclosure tags in the 'rss' namespace
            for enclosure in item.findall('rss:enclosure', namespaces):
                if delta_attr_key not in enclosure.attrib:
                    zip_url = enclosure.attrib.get('url', '')
                    break 

            if version and short_version and zip_url:
                items.append({
                    'build_num': version.strip(),
                    'short_version_str': short_version.strip(),
                    'description': description.strip(),
                    'zip_url': zip_url
                })

        print(json.dumps(items, separators=(',', ':')))

    except Exception as e:
        print(f"An unexpected error occurred during lxml parsing: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python parse_feed.py <path_to_feed.xml>", file=sys.stderr)
        sys.exit(1)